import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { athletes, householdGuardians, householdInvites, users } from "@/db/schema";
import type { EmergencyContact } from "@/db/schema/household";
import { writeAudit } from "@/lib/audit";
import { sendGuardianInviteEmail } from "@/lib/email";
import {
  athleteSchema,
  inviteSchema,
  profileSchema,
  type AthleteInput,
  type InviteInput,
  type ProfileInput,
} from "@/lib/validation/household";
import { DalError, isBoard, type SessionContext } from "./context";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url, no padding

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface MyProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  smsOptIn: boolean;
}

/** Roster row. Deliberately has NO medical notes / emergency contacts. */
export interface AthleteListItem {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: string | null;
  gradeLevel: string | null;
  hasMedicalNotes: boolean;
  relationship: string;
  canRegister: boolean;
}

export interface AthleteDetail {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: string | null;
  gradeLevel: string | null;
  medicalNotes: string | null;
  emergencyContacts: EmergencyContact[];
  /** True when the viewer is a guardian with canRegister (may edit). */
  canEdit: boolean;
}

export interface GuardianRow {
  athleteId: string;
  athleteName: string;
  userId: string;
  name: string;
  email: string;
  relationship: string;
  canRegister: boolean;
  canSignWaivers: boolean;
  receivesComms: boolean;
  isMe: boolean;
}

export interface PendingInvite {
  id: string;
  email: string;
  relationship: string;
  athleteNames: string[];
  expiresAt: Date;
  createdAt: Date;
}

export type InviteAcceptState =
  | { status: "not_found" | "expired" | "revoked" | "accepted" }
  | { status: "email_mismatch"; invitedEmail: string }
  | {
      status: "valid";
      invitedEmail: string;
      inviterName: string;
      relationship: string;
      athleteNames: string[];
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function assertUuid(id: string, what = "record"): void {
  if (!UUID_RE.test(id)) throw new DalError("NOT_FOUND", `That ${what} was not found.`);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function getGuardianLink(userId: string, athleteId: string) {
  const [link] = await db
    .select()
    .from(householdGuardians)
    .where(and(eq(householdGuardians.userId, userId), eq(householdGuardians.athleteId, athleteId)))
    .limit(1);
  return link ?? null;
}

async function athleteNamesById(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: athletes.id, firstName: athletes.firstName, lastName: athletes.lastName })
    .from(athletes)
    .where(and(inArray(athletes.id, ids), isNull(athletes.deletedAt)));
  return new Map(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export async function getMyProfile(ctx: SessionContext): Promise<MyProfile> {
  const [u] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      smsOptIn: users.smsOptIn,
    })
    .from(users)
    .where(and(eq(users.id, ctx.userId), isNull(users.deletedAt)))
    .limit(1);
  if (!u) throw new DalError("NOT_FOUND", "Profile not found.");
  return u;
}

export async function updateMyProfile(ctx: SessionContext, input: unknown): Promise<MyProfile> {
  const data: ProfileInput = profileSchema.parse(input);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ name: users.name, phone: users.phone, smsOptIn: users.smsOptIn })
      .from(users)
      .where(and(eq(users.id, ctx.userId), isNull(users.deletedAt)))
      .for("update")
      .limit(1);
    if (!before) throw new DalError("NOT_FOUND", "Profile not found.");

    const [after] = await tx
      .update(users)
      .set({ name: data.name, phone: data.phone, smsOptIn: data.smsOptIn })
      .where(eq(users.id, ctx.userId))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        smsOptIn: users.smsOptIn,
      });

    const fields = (["name", "phone", "smsOptIn"] as const).filter((f) => before[f] !== data[f]);
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "profile.updated",
        targetType: "user",
        targetId: ctx.userId,
        metadata: { fields },
      },
      tx
    );
    return after;
  });
}

// ---------------------------------------------------------------------------
// Athletes
// ---------------------------------------------------------------------------
/** Roster for the current user. NEVER selects medical notes or emergency contacts. */
export async function listMyAthletes(ctx: SessionContext): Promise<AthleteListItem[]> {
  return db
    .select({
      id: athletes.id,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      dateOfBirth: athletes.dateOfBirth,
      gender: athletes.gender,
      gradeLevel: athletes.gradeLevel,
      // Boolean computed in SQL: the note text itself never leaves the database here.
      hasMedicalNotes: sql<boolean>`coalesce(length(btrim(${athletes.medicalNotes})) > 0, false)`,
      relationship: householdGuardians.relationship,
      canRegister: householdGuardians.canRegister,
    })
    .from(householdGuardians)
    .innerJoin(athletes, eq(athletes.id, householdGuardians.athleteId))
    .where(and(eq(householdGuardians.userId, ctx.userId), isNull(athletes.deletedAt)))
    .orderBy(asc(athletes.firstName), asc(athletes.lastName));
}

/** Guardian of the athlete or board. ALWAYS writes a medical.viewed audit row. */
export async function getAthleteDetail(ctx: SessionContext, athleteId: string): Promise<AthleteDetail> {
  assertUuid(athleteId, "athlete");
  const link = await getGuardianLink(ctx.userId, athleteId);
  const board = isBoard(ctx);
  if (!link && !board) throw new DalError("FORBIDDEN", "You do not have access to this athlete.");

  const [a] = await db
    .select()
    .from(athletes)
    .where(and(eq(athletes.id, athleteId), isNull(athletes.deletedAt)))
    .limit(1);
  if (!a) throw new DalError("NOT_FOUND", "Athlete not found.");

  // Fail closed: if the audit write fails, the data is not returned.
  await writeAudit({
    actorUserId: ctx.userId,
    action: "medical.viewed",
    targetType: "athlete",
    targetId: athleteId,
    metadata: { via: link ? "guardian" : "board" },
  });

  return {
    id: a.id,
    firstName: a.firstName,
    lastName: a.lastName,
    dateOfBirth: a.dateOfBirth,
    gender: a.gender,
    gradeLevel: a.gradeLevel,
    medicalNotes: a.medicalNotes,
    emergencyContacts: a.emergencyContacts,
    canEdit: !!link?.canRegister,
  };
}

export async function createAthlete(ctx: SessionContext, input: unknown): Promise<{ id: string }> {
  const data: AthleteInput = athleteSchema.parse(input);
  return db.transaction(async (tx) => {
    const [a] = await tx
      .insert(athletes)
      .values({
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender,
        gradeLevel: data.gradeLevel,
        medicalNotes: data.medicalNotes,
        emergencyContacts: data.emergencyContacts,
      })
      .returning({ id: athletes.id });

    await tx.insert(householdGuardians).values({
      athleteId: a.id,
      userId: ctx.userId,
      relationship: data.relationship,
      canRegister: true,
      canSignWaivers: true,
      receivesComms: true,
    });

    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "athlete.created",
        targetType: "athlete",
        targetId: a.id,
      },
      tx
    );
    return { id: a.id };
  });
}

/** Guardian with canRegister only. Audits medical.updated when notes/contacts change. */
export async function updateAthlete(
  ctx: SessionContext,
  athleteId: string,
  input: unknown
): Promise<{ id: string }> {
  assertUuid(athleteId, "athlete");
  const data: AthleteInput = athleteSchema.parse(input);
  return db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(householdGuardians)
      .where(
        and(eq(householdGuardians.userId, ctx.userId), eq(householdGuardians.athleteId, athleteId))
      )
      .limit(1);
    if (!link || !link.canRegister) {
      throw new DalError("FORBIDDEN", "You do not have permission to edit this athlete.");
    }

    const [cur] = await tx
      .select()
      .from(athletes)
      .where(and(eq(athletes.id, athleteId), isNull(athletes.deletedAt)))
      .for("update")
      .limit(1);
    if (!cur) throw new DalError("NOT_FOUND", "Athlete not found.");

    const changed: string[] = [];
    if ((cur.medicalNotes ?? null) !== data.medicalNotes) changed.push("medicalNotes");
    if (JSON.stringify(cur.emergencyContacts) !== JSON.stringify(data.emergencyContacts)) {
      changed.push("emergencyContacts");
    }

    await tx
      .update(athletes)
      .set({
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender,
        gradeLevel: data.gradeLevel,
        medicalNotes: data.medicalNotes,
        emergencyContacts: data.emergencyContacts,
      })
      .where(eq(athletes.id, athleteId));

    if (changed.length > 0) {
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "medical.updated",
          targetType: "athlete",
          targetId: athleteId,
          metadata: { fields: changed },
        },
        tx
      );
    }
    return { id: athleteId };
  });
}

// ---------------------------------------------------------------------------
// Guardians
// ---------------------------------------------------------------------------
/**
 * Guardians of one athlete (guardian or board), or - with no athleteId - of
 * every athlete the current user is a guardian of.
 */
export async function listGuardians(ctx: SessionContext, athleteId?: string): Promise<GuardianRow[]> {
  let scope;
  if (athleteId) {
    assertUuid(athleteId, "athlete");
    const link = await getGuardianLink(ctx.userId, athleteId);
    if (!link && !isBoard(ctx)) {
      throw new DalError("FORBIDDEN", "You do not have access to this athlete.");
    }
    scope = eq(householdGuardians.athleteId, athleteId);
  } else {
    scope = inArray(
      householdGuardians.athleteId,
      db
        .select({ id: householdGuardians.athleteId })
        .from(householdGuardians)
        .where(eq(householdGuardians.userId, ctx.userId))
    );
  }

  const rows = await db
    .select({
      athleteId: householdGuardians.athleteId,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      userId: users.id,
      name: users.name,
      email: users.email,
      relationship: householdGuardians.relationship,
      canRegister: householdGuardians.canRegister,
      canSignWaivers: householdGuardians.canSignWaivers,
      receivesComms: householdGuardians.receivesComms,
    })
    .from(householdGuardians)
    .innerJoin(athletes, eq(athletes.id, householdGuardians.athleteId))
    .innerJoin(users, eq(users.id, householdGuardians.userId))
    .where(and(scope, isNull(athletes.deletedAt), isNull(users.deletedAt)))
    .orderBy(asc(athletes.firstName), asc(athletes.lastName), asc(householdGuardians.createdAt));

  return rows.map((r) => ({
    athleteId: r.athleteId,
    athleteName: `${r.firstName} ${r.lastName}`,
    userId: r.userId,
    name: r.name,
    email: r.email,
    relationship: r.relationship,
    canRegister: r.canRegister,
    canSignWaivers: r.canSignWaivers,
    receivesComms: r.receivesComms,
    isMe: r.userId === ctx.userId,
  }));
}

/**
 * Remove a guardian link. Allowed for: the guardian themselves, a guardian with
 * canRegister, or board. Never removes the last (active) guardian of an athlete.
 */
export async function removeGuardian(
  ctx: SessionContext,
  athleteId: string,
  userId: string
): Promise<void> {
  assertUuid(athleteId, "athlete");
  await db.transaction(async (tx) => {
    // Lock all guardian rows of this athlete so concurrent removals serialize.
    const links = await tx
      .select({
        id: householdGuardians.id,
        userId: householdGuardians.userId,
        canRegister: householdGuardians.canRegister,
      })
      .from(householdGuardians)
      .where(eq(householdGuardians.athleteId, athleteId))
      .for("update");

    const me = links.find((l) => l.userId === ctx.userId);
    const target = links.find((l) => l.userId === userId);
    const allowed = isBoard(ctx) || (me && (me.userId === userId || me.canRegister));
    if (!allowed) throw new DalError("FORBIDDEN", "You do not have permission to remove this guardian.");
    if (!target) throw new DalError("NOT_FOUND", "Guardian not found.");

    const otherIds = links.filter((l) => l.userId !== userId).map((l) => l.userId);
    const active =
      otherIds.length === 0
        ? []
        : await tx
            .select({ id: users.id })
            .from(users)
            .where(and(inArray(users.id, otherIds), isNull(users.deletedAt)));
    if (active.length === 0) {
      throw new DalError("INVALID", "You cannot remove the last guardian of an athlete.");
    }

    await tx.delete(householdGuardians).where(eq(householdGuardians.id, target.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "guardian.removed",
        targetType: "athlete",
        targetId: athleteId,
        metadata: { removedUserId: userId, self: userId === ctx.userId },
      },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------
export async function createGuardianInvite(
  ctx: SessionContext,
  input: unknown
): Promise<{ inviteId: string; emailSent: boolean }> {
  const data: InviteInput = inviteSchema.parse(input);
  if (data.email === ctx.email.toLowerCase()) {
    throw new DalError("INVALID", "You cannot invite yourself.");
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  const { inviteId, athleteNames } = await db.transaction(async (tx) => {
    // Inviter must hold canRegister on EVERY athlete.
    const links = await tx
      .select({ athleteId: householdGuardians.athleteId })
      .from(householdGuardians)
      .innerJoin(athletes, eq(athletes.id, householdGuardians.athleteId))
      .where(
        and(
          eq(householdGuardians.userId, ctx.userId),
          eq(householdGuardians.canRegister, true),
          inArray(householdGuardians.athleteId, data.athleteIds),
          isNull(athletes.deletedAt)
        )
      );
    if (links.length !== data.athleteIds.length) {
      throw new DalError("FORBIDDEN", "You can only invite guardians to athletes you manage.");
    }

    const [inv] = await tx
      .insert(householdInvites)
      .values({
        invitedByUserId: ctx.userId,
        email: data.email,
        relationship: data.relationship,
        athleteIds: data.athleteIds,
        canRegister: data.canRegister,
        canSignWaivers: data.canSignWaivers,
        receivesComms: data.receivesComms,
        tokenHash,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning({ id: householdInvites.id });

    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "guardian.invited",
        targetType: "household_invite",
        targetId: inv.id,
        metadata: { email: data.email, athleteIds: data.athleteIds },
      },
      tx
    );

    const nameRows = await tx
      .select({ firstName: athletes.firstName, lastName: athletes.lastName })
      .from(athletes)
      .where(inArray(athletes.id, data.athleteIds));
    return {
      inviteId: inv.id,
      athleteNames: nameRows.map((r) => `${r.firstName} ${r.lastName}`),
    };
  });

  // Email goes out after commit; a delivery failure must not undo the invite
  // (it can be revoked and re-sent from the pending list).
  const base = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  let emailSent = true;
  try {
    await sendGuardianInviteEmail({
      to: data.email,
      inviterName: ctx.name,
      athleteNames,
      acceptUrl: `${base}/household/invite/${token}`,
    });
  } catch (err) {
    emailSent = false;
    console.error("[createGuardianInvite] email delivery failed", err);
  }
  return { inviteId, emailSent };
}

export async function listMyPendingInvites(ctx: SessionContext): Promise<PendingInvite[]> {
  const rows = await db
    .select()
    .from(householdInvites)
    .where(
      and(
        eq(householdInvites.invitedByUserId, ctx.userId),
        isNull(householdInvites.acceptedAt),
        isNull(householdInvites.revokedAt),
        gt(householdInvites.expiresAt, new Date())
      )
    )
    .orderBy(desc(householdInvites.createdAt));

  const names = await athleteNamesById([...new Set(rows.flatMap((r) => r.athleteIds))]);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    relationship: r.relationship,
    athleteNames: r.athleteIds.map((id) => names.get(id)).filter((n): n is string => !!n),
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}

export async function revokeInvite(ctx: SessionContext, inviteId: string): Promise<void> {
  assertUuid(inviteId, "invitation");
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.id, inviteId))
      .for("update")
      .limit(1);
    if (!inv || inv.invitedByUserId !== ctx.userId) {
      throw new DalError("FORBIDDEN", "You can only revoke invitations you sent.");
    }
    if (inv.acceptedAt || inv.revokedAt) {
      throw new DalError("INVALID", "This invitation is no longer pending.");
    }
    await tx
      .update(householdInvites)
      .set({ revokedAt: new Date() })
      .where(eq(householdInvites.id, inviteId));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "guardian.invite_revoked",
        targetType: "household_invite",
        targetId: inviteId,
        metadata: { email: inv.email },
      },
      tx
    );
  });
}

/**
 * Describes an invite for the accept page. Child names are only disclosed when
 * the signed-in email matches the invited email.
 */
export async function getInviteForAccept(
  ctx: SessionContext,
  token: string
): Promise<InviteAcceptState> {
  if (!TOKEN_RE.test(token)) return { status: "not_found" };
  const [inv] = await db
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.tokenHash, hashToken(token)))
    .limit(1);
  if (!inv) return { status: "not_found" };
  if (inv.acceptedAt) return { status: "accepted" };
  if (inv.revokedAt) return { status: "revoked" };
  if (inv.expiresAt.getTime() <= Date.now()) return { status: "expired" };
  if (inv.email !== ctx.email.toLowerCase()) {
    return { status: "email_mismatch", invitedEmail: inv.email };
  }

  const [inviter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, inv.invitedByUserId))
    .limit(1);
  const names = await athleteNamesById(inv.athleteIds);
  return {
    status: "valid",
    invitedEmail: inv.email,
    inviterName: inviter?.name ?? "A GBYS family",
    relationship: inv.relationship,
    athleteNames: inv.athleteIds.map((id) => names.get(id)).filter((n): n is string => !!n),
  };
}

export async function acceptGuardianInvite(
  ctx: SessionContext,
  token: string
): Promise<{ athleteCount: number }> {
  if (!TOKEN_RE.test(token)) throw new DalError("NOT_FOUND", "This invitation was not found.");
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(householdInvites)
      .where(eq(householdInvites.tokenHash, hashToken(token)))
      .for("update")
      .limit(1);
    if (!inv) throw new DalError("NOT_FOUND", "This invitation was not found.");
    if (inv.acceptedAt) throw new DalError("INVALID", "This invitation has already been accepted.");
    if (inv.revokedAt) throw new DalError("INVALID", "This invitation was revoked.");
    if (inv.expiresAt.getTime() <= Date.now()) {
      throw new DalError("INVALID", "This invitation has expired. Ask for a new one.");
    }
    if (inv.email !== ctx.email.toLowerCase()) {
      throw new DalError(
        "FORBIDDEN",
        `This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`
      );
    }

    const live = await tx
      .select({ id: athletes.id })
      .from(athletes)
      .where(and(inArray(athletes.id, inv.athleteIds), isNull(athletes.deletedAt)));
    if (live.length === 0) throw new DalError("INVALID", "The athletes on this invitation no longer exist.");

    await tx
      .insert(householdGuardians)
      .values(
        live.map((a) => ({
          athleteId: a.id,
          userId: ctx.userId,
          relationship: inv.relationship,
          canRegister: inv.canRegister,
          canSignWaivers: inv.canSignWaivers,
          receivesComms: inv.receivesComms,
        }))
      )
      .onConflictDoNothing();

    await tx
      .update(householdInvites)
      .set({ acceptedAt: new Date(), acceptedByUserId: ctx.userId })
      .where(eq(householdInvites.id, inv.id));

    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "guardian.invite_accepted",
        targetType: "household_invite",
        targetId: inv.id,
        metadata: { athleteIds: live.map((a) => a.id), invitedByUserId: inv.invitedByUserId },
      },
      tx
    );
    return { athleteCount: live.length };
  });
}
