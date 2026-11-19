import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { athletes, householdGuardians, programs, registrations, seasons, teamPlayers, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { PhotoError, processPhoto } from "@/lib/image";
import { deletePrivateObject, getPrivateObject, putPrivateObject } from "@/lib/storage";
import { DalError, isBoard, type SessionContext } from "./context";
import { canManageProgram } from "./permissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Versioned URL for an athlete photo (null when none). Safe to hand to any viewer; the route re-checks access. */
export function athletePhotoUrl(a: { id: string; photoObjectKey: string | null; photoUpdatedAt: Date | null }): string | null {
  if (!a.photoObjectKey || !a.photoUpdatedAt) return null;
  return `/media/athlete/${a.id}?v=${a.photoUpdatedAt.getTime()}`;
}

/** Best-effort delete: never fails the caller. */
async function deleteQuietly(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await deletePrivateObject(key);
  } catch (err) {
    console.error("[photos] failed to delete old object", key, err);
  }
}

async function fileToBuffer(file: unknown): Promise<Buffer> {
  if (!(file instanceof File)) throw new DalError("INVALID", "Choose a photo to upload.");
  // Reject obviously oversized uploads before buffering (processPhoto re-checks).
  if (file.size > 8 * 1024 * 1024) throw new DalError("INVALID", "Photos must be 8 MB or smaller.");
  return Buffer.from(await file.arrayBuffer());
}

async function process(buf: Buffer, size: 512 | 800): Promise<Buffer> {
  try {
    return await processPhoto(buf, size);
  } catch (err) {
    if (err instanceof PhotoError) throw new DalError("INVALID", err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
/**
 * Guardian of the athlete, the board, a program admin of a program where the athlete has a
 * live registration, or staff of a team that has one of the athlete's live registrations on
 * its roster. Head coaches with only a program-level role (no team) get NO access.
 * Returns false (never throws) so callers can answer 404 without leaking existence.
 */
export async function canViewAthletePhoto(ctx: SessionContext, athleteId: string): Promise<boolean> {
  if (!UUID_RE.test(athleteId)) return false;
  const [a] = await db
    .select({ id: athletes.id })
    .from(athletes)
    .where(and(eq(athletes.id, athleteId), isNull(athletes.deletedAt)))
    .limit(1);
  if (!a) return false;
  if (isBoard(ctx)) return true;

  const [link] = await db
    .select({ userId: householdGuardians.userId })
    .from(householdGuardians)
    .where(and(eq(householdGuardians.athleteId, athleteId), eq(householdGuardians.userId, ctx.userId)))
    .limit(1);
  if (link) return true;

  const adminProgramIds = new Set(ctx.programRoles.filter((g) => g.role === "program_admin").map((g) => g.programId));
  const teamIds = [...new Set(ctx.teamStaff.map((t) => t.teamId))];
  if (adminProgramIds.size === 0 && teamIds.length === 0) return false;

  if (adminProgramIds.size > 0) {
    const regs = await db
      .select({ programId: programs.id, active: programs.isActive })
      .from(registrations)
      .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
      .innerJoin(programs, eq(programs.id, seasons.programId))
      .where(and(eq(registrations.athleteId, athleteId), isNull(registrations.deletedAt), isNull(programs.deletedAt)));
    if (regs.some((r) => r.active && adminProgramIds.has(r.programId) && canManageProgram(ctx, r.programId))) return true;
  }

  if (teamIds.length > 0) {
    const [onTeam] = await db
      .select({ id: teamPlayers.id })
      .from(teamPlayers)
      .innerJoin(registrations, eq(registrations.id, teamPlayers.registrationId))
      .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
      .innerJoin(programs, eq(programs.id, seasons.programId))
      .where(
        and(
          eq(registrations.athleteId, athleteId),
          isNull(registrations.deletedAt),
          isNull(teamPlayers.removedAt),
          inArray(teamPlayers.teamId, teamIds),
          eq(programs.isActive, true),
          isNull(programs.deletedAt)
        )
      )
      .limit(1);
    if (onTeam) return true;
  }
  return false;
}

/** Photo bytes for the media route, or null (no access / no photo: indistinguishable to the caller). */
export async function getAthletePhotoObject(ctx: SessionContext, athleteId: string) {
  if (!(await canViewAthletePhoto(ctx, athleteId))) return null;
  const [a] = await db
    .select({ key: athletes.photoObjectKey })
    .from(athletes)
    .where(and(eq(athletes.id, athleteId), isNull(athletes.deletedAt)))
    .limit(1);
  if (!a?.key) return null;
  return getPrivateObject(a.key);
}

/** Any signed-in user may load an avatar (names and faces are already visible app-wide to signed-in users). */
export async function getAvatarObject(_ctx: SessionContext, userId: string) {
  if (!USER_ID_RE.test(userId)) return null; // user ids are Better Auth strings, not UUIDs
  const [u] = await db
    .select({ key: users.avatarObjectKey })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!u?.key) return null;
  return getPrivateObject(u.key);
}

// ---------------------------------------------------------------------------
// Athlete photos
// ---------------------------------------------------------------------------
async function assertCanEditAthletePhoto(ctx: SessionContext, athleteId: string): Promise<void> {
  if (!UUID_RE.test(athleteId)) throw new DalError("NOT_FOUND", "Athlete not found.");
  if (isBoard(ctx)) return;
  const [link] = await db
    .select({ canRegister: householdGuardians.canRegister })
    .from(householdGuardians)
    .where(and(eq(householdGuardians.athleteId, athleteId), eq(householdGuardians.userId, ctx.userId)))
    .limit(1);
  if (!link?.canRegister) throw new DalError("FORBIDDEN", "You do not have permission to change this photo.");
}

/** Guardian with canRegister, or the board. Never stores the original. */
export async function uploadAthletePhoto(
  ctx: SessionContext,
  athleteId: string,
  file: unknown
): Promise<{ photoUrl: string }> {
  await assertCanEditAthletePhoto(ctx, athleteId);
  const webp = await process(await fileToBuffer(file), 800);
  const key = `athletes/${athleteId}/${randomUUID()}.webp`;
  await putPrivateObject(key, webp, "image/webp");

  let previous: string | null = null;
  let updatedAt: Date;
  try {
    ({ previous, updatedAt } = await db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ key: athletes.photoObjectKey })
        .from(athletes)
        .where(and(eq(athletes.id, athleteId), isNull(athletes.deletedAt)))
        .for("update")
        .limit(1);
      if (!cur) throw new DalError("NOT_FOUND", "Athlete not found.");
      const now = new Date();
      await tx.update(athletes).set({ photoObjectKey: key, photoUpdatedAt: now }).where(eq(athletes.id, athleteId));
      await writeAudit(
        { actorUserId: ctx.userId, action: "photo.updated", targetType: "athlete", targetId: athleteId, metadata: { kind: "athlete" } },
        tx
      );
      return { previous: cur.key, updatedAt: now };
    }));
  } catch (err) {
    await deleteQuietly(key); // don't orphan the new object
    throw err;
  }
  await deleteQuietly(previous);
  return { photoUrl: athletePhotoUrl({ id: athleteId, photoObjectKey: key, photoUpdatedAt: updatedAt })! };
}

export async function removeAthletePhoto(ctx: SessionContext, athleteId: string): Promise<void> {
  await assertCanEditAthletePhoto(ctx, athleteId);
  const previous = await db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ key: athletes.photoObjectKey })
      .from(athletes)
      .where(and(eq(athletes.id, athleteId), isNull(athletes.deletedAt)))
      .for("update")
      .limit(1);
    if (!cur) throw new DalError("NOT_FOUND", "Athlete not found.");
    if (!cur.key) return null;
    await tx.update(athletes).set({ photoObjectKey: null, photoUpdatedAt: null }).where(eq(athletes.id, athleteId));
    await writeAudit(
      { actorUserId: ctx.userId, action: "photo.removed", targetType: "athlete", targetId: athleteId, metadata: { kind: "athlete" } },
      tx
    );
    return cur.key;
  });
  await deleteQuietly(previous);
}

// ---------------------------------------------------------------------------
// Profile photo (avatar)
// ---------------------------------------------------------------------------
export async function uploadMyAvatar(ctx: SessionContext, file: unknown): Promise<{ avatarUrl: string }> {
  const webp = await process(await fileToBuffer(file), 512);
  const key = `avatars/${ctx.userId}/${randomUUID()}.webp`;
  await putPrivateObject(key, webp, "image/webp");

  let previous: string | null = null;
  let updatedAt: Date;
  try {
    ({ previous, updatedAt } = await db.transaction(async (tx) => {
      const [cur] = await tx
        .select({ key: users.avatarObjectKey })
        .from(users)
        .where(and(eq(users.id, ctx.userId), isNull(users.deletedAt)))
        .for("update")
        .limit(1);
      if (!cur) throw new DalError("NOT_FOUND", "Profile not found.");
      const now = new Date();
      await tx.update(users).set({ avatarObjectKey: key, avatarUpdatedAt: now }).where(eq(users.id, ctx.userId));
      await writeAudit(
        { actorUserId: ctx.userId, action: "photo.updated", targetType: "user", targetId: ctx.userId, metadata: { kind: "avatar" } },
        tx
      );
      return { previous: cur.key, updatedAt: now };
    }));
  } catch (err) {
    await deleteQuietly(key);
    throw err;
  }
  await deleteQuietly(previous);
  return { avatarUrl: `/media/avatar/${ctx.userId}?v=${updatedAt.getTime()}` };
}

export async function removeMyAvatar(ctx: SessionContext): Promise<void> {
  const previous = await db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ key: users.avatarObjectKey })
      .from(users)
      .where(and(eq(users.id, ctx.userId), isNull(users.deletedAt)))
      .for("update")
      .limit(1);
    if (!cur) throw new DalError("NOT_FOUND", "Profile not found.");
    if (!cur.key) return null;
    await tx.update(users).set({ avatarObjectKey: null, avatarUpdatedAt: null }).where(eq(users.id, ctx.userId));
    await writeAudit(
      { actorUserId: ctx.userId, action: "photo.removed", targetType: "user", targetId: ctx.userId, metadata: { kind: "avatar" } },
      tx
    );
    return cur.key;
  });
  await deleteQuietly(previous);
}
