import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  credentialDefinitions,
  householdGuardians,
  athletes,
  programs,
  registrations,
  seasons,
  userCredentials,
  volunteerRoleAssignments,
  volunteerRoles,
} from "@/db/schema";
import { utcToLaDateInput } from "@/lib/format";
import type { SessionContext } from "./context";
import { listMyAthletes } from "./households";

export interface DashboardAthlete {
  id: string;
  firstName: string;
  age: number | null;
  /** Present once the photo feature supplies it; the UI falls back to initials. */
  photoUrl: string | null;
}

export interface DashboardRegistration {
  id: string;
  athleteName: string;
  programName: string;
  seasonName: string;
  seasonStartsOn: string | null;
  seasonEndsOn: string | null;
  paymentStatus: "unpaid" | "pending" | "paid" | "waived_scholarship" | "refunded";
  feeCents: number;
}

export interface DashboardDue {
  registrationId: string;
  athleteName: string;
  programName: string;
  seasonName: string;
  feeCents: number;
}

export interface AttentionItem {
  key: string;
  kind: "missing_credentials" | "pending_request" | "expiring_credential" | "unpaid_dues";
  title: string;
  detail: string;
  href: string;
}

export interface DashboardRole {
  id: string;
  roleName: string;
  programName: string | null;
  termLabel: string;
  status: "pending" | "active";
}

export interface MemberDashboard {
  household: DashboardAthlete[];
  registrations: DashboardRegistration[];
  dues: { totalCents: number; items: DashboardDue[] };
  attention: AttentionItem[];
  /** Attention items beyond the 4 shown. */
  attentionMore: number;
  roles: DashboardRole[];
}

const MAX_ATTENTION = 4;
const EXPIRING_DAYS = 30;

/** Whole years on the Pacific calendar date `today`. */
export function ageOn(dob: string, today: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  if (!m || !t) return null;
  let age = Number(t[1]) - Number(m[1]);
  if (Number(t[2]) < Number(m[2]) || (Number(t[2]) === Number(m[2]) && Number(t[3]) < Number(m[3]))) age--;
  return age >= 0 ? age : null;
}

/**
 * Everything on the member dashboard, for the signed-in user only (every query
 * is keyed on ctx.userId). No medical data, no volunteer hours.
 */
export async function getMemberDashboard(ctx: SessionContext, now: Date = new Date()): Promise<MemberDashboard> {
  const today = utcToLaDateInput(now);
  const soon = new Date(now.getTime() + EXPIRING_DAYS * 86_400_000);

  const [athleteRows, regRows, roleRows, myCreds] = await Promise.all([
    listMyAthletes(ctx),
    db
      .select({
        id: registrations.id,
        firstName: athletes.firstName,
        lastName: athletes.lastName,
        programName: programs.name,
        seasonName: seasons.name,
        startsOn: seasons.startsOn,
        endsOn: seasons.endsOn,
        paymentStatus: registrations.paymentStatus,
        feeCents: registrations.feeCents,
      })
      .from(registrations)
      .innerJoin(
        householdGuardians,
        and(eq(householdGuardians.athleteId, registrations.athleteId), eq(householdGuardians.userId, ctx.userId))
      )
      .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
      .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
      .innerJoin(programs, eq(programs.id, seasons.programId))
      .where(and(isNull(registrations.deletedAt), isNull(athletes.deletedAt)))
      .orderBy(sql`${seasons.startsOn} asc nulls last`, asc(athletes.firstName), desc(registrations.createdAt)),
    db
      .select({
        id: volunteerRoleAssignments.id,
        roleName: volunteerRoles.name,
        programName: programs.name,
        seasonName: seasons.name,
        year: volunteerRoleAssignments.year,
        status: volunteerRoleAssignments.status,
        requiredCredentialIds: volunteerRoles.requiredCredentialIds,
        signedUpAt: volunteerRoleAssignments.signedUpAt,
      })
      .from(volunteerRoleAssignments)
      .innerJoin(volunteerRoles, eq(volunteerRoles.id, volunteerRoleAssignments.roleId))
      .leftJoin(programs, eq(programs.id, volunteerRoles.programId))
      .leftJoin(seasons, eq(seasons.id, volunteerRoleAssignments.seasonId))
      .where(
        and(
          eq(volunteerRoleAssignments.userId, ctx.userId),
          inArray(volunteerRoleAssignments.status, ["pending", "active"])
        )
      )
      .orderBy(asc(volunteerRoleAssignments.status), desc(volunteerRoleAssignments.signedUpAt)),
    db
      .select({
        definitionId: userCredentials.definitionId,
        name: credentialDefinitions.name,
        status: userCredentials.status,
        expiresAt: userCredentials.expiresAt,
      })
      .from(userCredentials)
      .innerJoin(credentialDefinitions, eq(credentialDefinitions.id, userCredentials.definitionId))
      .where(eq(userCredentials.userId, ctx.userId)),
  ]);

  // Household: plain names only. photoUrl is added to the summary by the photos work.
  const household: DashboardAthlete[] = athleteRows.map((a) => ({
    id: a.id,
    firstName: a.firstName,
    age: ageOn(a.dateOfBirth, today),
    photoUrl: (a as { photoUrl?: string | null }).photoUrl ?? null,
  }));

  // Registered programs: live registrations for current and upcoming seasons.
  const regs: DashboardRegistration[] = regRows
    .filter((r) => !r.endsOn || r.endsOn >= today)
    .map((r) => ({
      id: r.id,
      athleteName: `${r.firstName} ${r.lastName}`,
      programName: r.programName,
      seasonName: r.seasonName,
      seasonStartsOn: r.startsOn,
      seasonEndsOn: r.endsOn,
      paymentStatus: r.paymentStatus,
      feeCents: r.feeCents,
    }));

  // Outstanding dues: every live unpaid registration (a past season can still owe money).
  const dueItems: DashboardDue[] = regRows
    .filter((r) => r.paymentStatus === "unpaid" && r.feeCents > 0)
    .map((r) => ({
      registrationId: r.id,
      athleteName: `${r.firstName} ${r.lastName}`,
      programName: r.programName,
      seasonName: r.seasonName,
      feeCents: r.feeCents,
    }));
  const totalCents = dueItems.reduce((s, d) => s + d.feeCents, 0);

  const roles: DashboardRole[] = roleRows.map((r) => ({
    id: r.id,
    roleName: r.roleName,
    programName: r.programName,
    termLabel: r.seasonName ?? String(r.year),
    status: r.status as "pending" | "active",
  }));
  roles.sort((a, b) => Number(b.status === "active") - Number(a.status === "active")); // stable: newest first within a status

  // Needs your attention, in priority order.
  const valid = new Set(
    myCreds
      .filter((c) => c.status === "verified" && (!c.expiresAt || c.expiresAt > now))
      .map((c) => c.definitionId)
  );
  const credNames = new Map<string, string>();
  const requiredIds = [...new Set(roleRows.filter((r) => r.status === "active").flatMap((r) => r.requiredCredentialIds))];
  if (requiredIds.length > 0) {
    const defs = await db
      .select({ id: credentialDefinitions.id, name: credentialDefinitions.name })
      .from(credentialDefinitions)
      .where(inArray(credentialDefinitions.id, requiredIds));
    for (const d of defs) credNames.set(d.id, d.name);
  }

  const items: AttentionItem[] = [];
  for (const r of roleRows.filter((x) => x.status === "active")) {
    const missing = r.requiredCredentialIds.filter((id) => credNames.has(id) && !valid.has(id)).map((id) => credNames.get(id)!);
    if (missing.length > 0) {
      items.push({
        key: `missing:${r.id}`,
        kind: "missing_credentials",
        title: `${r.roleName}: add your credentials`,
        detail: `Still needed: ${missing.join(", ")}`,
        href: "/volunteer/credentials",
      });
    }
  }
  const pending = roleRows.filter((r) => r.status === "pending");
  if (pending.length > 0) {
    items.push({
      key: "pending",
      kind: "pending_request",
      title: pending.length === 1 ? `Role request waiting: ${pending[0].roleName}` : `${pending.length} role requests waiting`,
      detail: "A program leader will review it.",
      href: "/volunteer/roles",
    });
  }
  for (const c of myCreds
    .filter((c) => c.status === "verified" && c.expiresAt && c.expiresAt > now && c.expiresAt <= soon)
    .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())) {
    const days = Math.max(0, Math.ceil((c.expiresAt!.getTime() - now.getTime()) / 86_400_000));
    items.push({
      key: `expiring:${c.definitionId}:${c.expiresAt!.getTime()}`,
      kind: "expiring_credential",
      title: `${c.name} expires soon`,
      detail: days <= 1 ? "Expires within a day. Upload a renewal." : `Expires in ${days} days. Upload a renewal.`,
      href: "/volunteer/credentials",
    });
  }
  if (totalCents > 0) {
    items.push({
      key: "dues",
      kind: "unpaid_dues",
      title: `${dueItems.length === 1 ? "1 registration" : `${dueItems.length} registrations`} unpaid`,
      detail: "Pay your program by cash or check.",
      href: "/registrations",
    });
  }

  return {
    household,
    registrations: regs,
    dues: { totalCents, items: dueItems },
    attention: items.slice(0, MAX_ATTENTION),
    attentionMore: Math.max(0, items.length - MAX_ATTENTION),
    roles,
  };
}
