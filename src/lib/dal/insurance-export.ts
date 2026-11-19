import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  athletes,
  credentialDefinitions,
  householdGuardians,
  programs,
  registrations,
  seasons,
  teamPlayers,
  teamStaff,
  teams,
  userCredentials,
  users,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { utcToLaDateInput } from "@/lib/format";
import { DalError, isBoard, type SessionContext } from "./context";
import { canViewSeasonRoster } from "./permissions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Credential codes used when the program has not configured required credentials. */
export const DEFAULT_CREDENTIAL_CODES = ["first_advantage_bg", "safesport"] as const;

export type InsuranceCredentialStatus = "Verified" | "Expired" | "Pending review" | "Rejected" | "Missing";

export interface InsurancePlayer {
  registrationId: string;
  lastName: string;
  firstName: string;
  dateOfBirth: string;
  ageAtSeasonStart: number | null;
  gender: string;
  team: string;
  division: string;
  jerseyNumber: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
}

export interface InsuranceStaffCredential {
  status: InsuranceCredentialStatus;
  /** YYYY-MM-DD (Pacific) or "" */
  expiresOn: string;
}

export interface InsuranceStaff {
  userId: string;
  name: string;
  role: string;
  team: string;
  email: string;
  phone: string;
  /** One entry per `InsuranceExport.credentials`, same order. */
  credentials: InsuranceStaffCredential[];
}

export interface InsuranceExport {
  header: {
    seasonId: string;
    seasonName: string;
    startsOn: string | null;
    programId: string;
    programName: string;
    programSlug: string;
  };
  team: { id: string; name: string } | null;
  /** Age is computed on this date (YYYY-MM-DD): the season start, else today (Pacific). */
  ageReferenceDate: string;
  ageReferenceIsSeasonStart: boolean;
  credentials: { id: string; name: string }[];
  players: InsurancePlayer[];
  staff: InsuranceStaff[];
  generatedAt: Date;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Whole years between a YYYY-MM-DD date of birth and a YYYY-MM-DD reference date (no timezone math). */
export function ageOn(dob: string, ref: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ref);
  if (!d || !r) return null;
  let age = Number(r[1]) - Number(d[1]);
  if (Number(r[2]) < Number(d[2]) || (Number(r[2]) === Number(d[2]) && Number(r[3]) < Number(d[3]))) age -= 1;
  return age < 0 ? null : age;
}

/** Best status among a person's credentials of one type, as of `now`. */
export function summarizeCredential(
  creds: { status: "pending_review" | "verified" | "expired" | "rejected"; expiresAt: Date | null }[],
  now: Date
): InsuranceStaffCredential {
  const fmt = (d: Date | null) => (d ? utcToLaDateInput(d) : "");
  const valid = creds
    .filter((c) => c.status === "verified" && (!c.expiresAt || c.expiresAt > now))
    .sort((a, b) => (b.expiresAt?.getTime() ?? Infinity) - (a.expiresAt?.getTime() ?? Infinity));
  if (valid[0]) return { status: "Verified", expiresOn: fmt(valid[0].expiresAt) };
  const byExpiryDesc = (a: { expiresAt: Date | null }, b: { expiresAt: Date | null }) =>
    (b.expiresAt?.getTime() ?? 0) - (a.expiresAt?.getTime() ?? 0);
  const expired = creds.filter((c) => c.status === "expired" || (c.status === "verified" && c.expiresAt && c.expiresAt <= now)).sort(byExpiryDesc);
  const pending = creds.filter((c) => c.status === "pending_review");
  if (pending.length) return { status: "Pending review", expiresOn: "" };
  if (expired[0]) return { status: "Expired", expiresOn: fmt(expired[0].expiresAt) };
  if (creds.some((c) => c.status === "rejected")) return { status: "Rejected", expiresOn: "" };
  return { status: "Missing", expiresOn: "" };
}

export const ROLE_LABELS: Record<string, string> = {
  head_coach: "Head coach",
  assistant_coach: "Assistant coach",
  team_manager: "Team manager",
};

export function insuranceFilename(programSlug: string, seasonName: string): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "x";
  return `gbys-insurance-${slug(programSlug)}-${slug(seasonName)}.csv`;
}

const PLAYER_HEADERS = [
  "Last name",
  "First name",
  "Date of birth",
  "Age at season start",
  "Gender",
  "Team",
  "Division",
  "Jersey number",
  "Primary guardian",
  "Guardian phone",
  "Guardian email",
] as const;

/**
 * Players table, then a blank line, then the coaches/staff table (their own header row, with a
 * status and expiry column per required credential). Spreadsheet-safe via toCsv.
 * `part` limits the file to a single table.
 */
export function buildInsuranceCsv(data: InsuranceExport, part: "all" | "players" | "staff" = "all"): string {
  const players = toCsv(
    PLAYER_HEADERS,
    data.players.map((p) => [
      p.lastName,
      p.firstName,
      p.dateOfBirth,
      p.ageAtSeasonStart,
      p.gender,
      p.team,
      p.division,
      p.jerseyNumber,
      p.guardianName,
      p.guardianPhone,
      p.guardianEmail,
    ])
  );
  const staffHeaders = [
    "Name",
    "Role",
    "Team",
    "Email",
    "Phone",
    ...data.credentials.flatMap((c) => [`${c.name} status`, `${c.name} expires`]),
  ];
  const staff = toCsv(
    staffHeaders,
    data.staff.map((s) => [s.name, s.role, s.team, s.email, s.phone, ...s.credentials.flatMap((c) => [c.status, c.expiresOn])])
  );
  if (part === "players") return players;
  if (part === "staff") return staff;
  return players + "\r\n" + staff.slice(1); // drop the second BOM
}

// ---------------------------------------------------------------------------
// DAL
// ---------------------------------------------------------------------------

/**
 * Insurance roster for one season (optionally one team). Program admins and the board only.
 * Contains no medical data. Writes one `roster.exported` audit row (format, counts, team filter).
 */
export async function getInsuranceExport(
  ctx: SessionContext,
  seasonId: string,
  opts: { teamId?: string | null; format: "csv" | "print"; expectedProgramSlug?: string }
): Promise<InsuranceExport> {
  if (!UUID_RE.test(seasonId)) throw new DalError("NOT_FOUND", "Season not found.");
  const [s] = await db
    .select({
      seasonId: seasons.id,
      seasonName: seasons.name,
      startsOn: seasons.startsOn,
      programId: programs.id,
      programName: programs.name,
      programSlug: programs.slug,
      programActive: programs.isActive,
      requiredCredentialIds: programs.requiredCredentialIds,
    })
    .from(seasons)
    .innerJoin(programs, eq(programs.id, seasons.programId))
    .where(and(eq(seasons.id, seasonId), isNull(programs.deletedAt)))
    .limit(1);
  if (!s || !canViewSeasonRoster(ctx, s.programId)) throw new DalError("NOT_FOUND", "Season not found.");
  if (!s.programActive && !isBoard(ctx)) throw new DalError("NOT_FOUND", "Season not found.");
  if (opts.expectedProgramSlug !== undefined && s.programSlug !== opts.expectedProgramSlug) {
    throw new DalError("NOT_FOUND", "Season not found.");
  }

  let team: { id: string; name: string } | null = null;
  if (opts.teamId) {
    if (!UUID_RE.test(opts.teamId)) throw new DalError("NOT_FOUND", "Team not found.");
    const [t] = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, opts.teamId), eq(teams.seasonId, s.seasonId)))
      .limit(1);
    if (!t) throw new DalError("NOT_FOUND", "Team not found.");
    team = t;
  }

  const now = new Date();
  const today = utcToLaDateInput(now);
  const ageRef = s.startsOn ?? today;

  // ---- players: live registrations, with their live team (if any)
  const playerRows = await db
    .select({
      registrationId: registrations.id,
      athleteId: athletes.id,
      registeredBy: registrations.registeredByUserId,
      firstName: athletes.firstName,
      lastName: athletes.lastName,
      dateOfBirth: athletes.dateOfBirth,
      gender: athletes.gender,
      teamId: teams.id,
      teamName: teams.name,
      division: teams.division,
      jersey: teamPlayers.jerseyNumber,
    })
    .from(registrations)
    .innerJoin(athletes, eq(athletes.id, registrations.athleteId))
    .leftJoin(teamPlayers, and(eq(teamPlayers.registrationId, registrations.id), isNull(teamPlayers.removedAt)))
    .leftJoin(teams, eq(teams.id, teamPlayers.teamId))
    .where(and(eq(registrations.seasonId, s.seasonId), isNull(registrations.deletedAt), isNull(athletes.deletedAt)))
    .orderBy(asc(athletes.lastName), asc(athletes.firstName));
  const filteredPlayers = team ? playerRows.filter((p) => p.teamId === team!.id) : playerRows;

  const athleteIds = filteredPlayers.map((p) => p.athleteId);
  const guardianRows = athleteIds.length
    ? await db
        .select({
          athleteId: householdGuardians.athleteId,
          userId: users.id,
          name: users.name,
          phone: users.phone,
          email: users.email,
          receivesComms: householdGuardians.receivesComms,
          createdAt: householdGuardians.createdAt,
        })
        .from(householdGuardians)
        .innerJoin(users, eq(users.id, householdGuardians.userId))
        .where(and(inArray(householdGuardians.athleteId, athleteIds), isNull(users.deletedAt)))
    : [];
  const guardiansByAthlete = new Map<string, typeof guardianRows>();
  for (const g of guardianRows) guardiansByAthlete.set(g.athleteId, [...(guardiansByAthlete.get(g.athleteId) ?? []), g]);

  const players: InsurancePlayer[] = filteredPlayers.map((p) => {
    // Primary guardian: the registering adult if still linked, then one who receives comms, then the earliest.
    const gs = [...(guardiansByAthlete.get(p.athleteId) ?? [])].sort(
      (a, b) =>
        Number(b.userId === p.registeredBy) - Number(a.userId === p.registeredBy) ||
        Number(b.receivesComms) - Number(a.receivesComms) ||
        a.createdAt.getTime() - b.createdAt.getTime()
    );
    const g = gs[0];
    return {
      registrationId: p.registrationId,
      lastName: p.lastName,
      firstName: p.firstName,
      dateOfBirth: p.dateOfBirth,
      ageAtSeasonStart: ageOn(p.dateOfBirth, ageRef),
      gender: p.gender ?? "",
      team: p.teamName ?? "",
      division: p.division ?? "",
      jerseyNumber: p.jersey ?? "",
      guardianName: g?.name ?? "",
      guardianPhone: g?.phone ?? "",
      guardianEmail: g?.email ?? "",
    };
  });

  // ---- required credentials (program config, else first-advantage + SafeSport)
  const required = (s.requiredCredentialIds ?? []).filter((id) => UUID_RE.test(id));
  const defs = required.length
    ? await db
        .select({ id: credentialDefinitions.id, name: credentialDefinitions.name })
        .from(credentialDefinitions)
        .where(inArray(credentialDefinitions.id, required))
        .orderBy(asc(credentialDefinitions.name))
    : await db
        .select({ id: credentialDefinitions.id, name: credentialDefinitions.name, code: credentialDefinitions.code })
        .from(credentialDefinitions)
        .where(inArray(credentialDefinitions.code, [...DEFAULT_CREDENTIAL_CODES]))
        .orderBy(asc(credentialDefinitions.code)) // first_advantage_bg before safesport
        .then((r) => r.map(({ id, name }) => ({ id, name })));

  // ---- staff: live team staff on this season's teams
  const staffRows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: teamStaff.role,
      teamName: teams.name,
    })
    .from(teamStaff)
    .innerJoin(teams, eq(teams.id, teamStaff.teamId))
    .innerJoin(users, eq(users.id, teamStaff.userId))
    .where(
      and(
        eq(teams.seasonId, s.seasonId),
        isNull(teamStaff.removedAt),
        isNull(users.deletedAt),
        team ? eq(teams.id, team.id) : undefined
      )
    )
    .orderBy(asc(teams.name), asc(users.name));

  const staffUserIds = [...new Set(staffRows.map((r) => r.userId))];
  const credRows =
    staffUserIds.length && defs.length
      ? await db
          .select({
            userId: userCredentials.userId,
            definitionId: userCredentials.definitionId,
            status: userCredentials.status,
            expiresAt: userCredentials.expiresAt,
          })
          .from(userCredentials)
          .where(and(inArray(userCredentials.userId, staffUserIds), inArray(userCredentials.definitionId, defs.map((d) => d.id))))
      : [];
  const credKey = (u: string, d: string) => `${u}|${d}`;
  const credMap = new Map<string, typeof credRows>();
  for (const c of credRows) credMap.set(credKey(c.userId, c.definitionId), [...(credMap.get(credKey(c.userId, c.definitionId)) ?? []), c]);

  const staff: InsuranceStaff[] = staffRows.map((r) => ({
    userId: r.userId,
    name: r.name,
    role: ROLE_LABELS[r.role] ?? r.role,
    team: r.teamName,
    email: r.email,
    phone: r.phone ?? "",
    credentials: defs.map((d) => summarizeCredential(credMap.get(credKey(r.userId, d.id)) ?? [], now)),
  }));

  await writeAudit({
    actorUserId: ctx.userId,
    action: "roster.exported",
    targetType: "season",
    targetId: s.seasonId,
    metadata: {
      kind: "insurance",
      format: opts.format,
      teamId: team?.id ?? null,
      playerCount: players.length,
      staffCount: staff.length,
    },
  });

  return {
    header: {
      seasonId: s.seasonId,
      seasonName: s.seasonName,
      startsOn: s.startsOn,
      programId: s.programId,
      programName: s.programName,
      programSlug: s.programSlug,
    },
    team,
    ageReferenceDate: ageRef,
    ageReferenceIsSeasonStart: !!s.startsOn,
    credentials: defs,
    players,
    staff,
    generatedAt: now,
  };
}

/** Teams of a season for the export's team filter. Same access rule as the export. */
export async function listInsuranceTeams(ctx: SessionContext, seasonId: string): Promise<{ id: string; name: string }[]> {
  if (!UUID_RE.test(seasonId)) throw new DalError("NOT_FOUND", "Season not found.");
  const [s] = await db
    .select({ programId: seasons.programId })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1);
  if (!s || !canViewSeasonRoster(ctx, s.programId)) throw new DalError("NOT_FOUND", "Season not found.");
  return db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.seasonId, seasonId)).orderBy(asc(teams.name));
}
