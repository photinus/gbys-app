import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { db, type DbOrTx, type DbTx } from "@/db";
import {
  athletes,
  householdGuardians,
  programs,
  registrations,
  resourceBookings,
  resources,
  teamEvents,
  teamPlayers,
  teams,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { formatTimeRange } from "@/lib/format";
import {
  cancelScopeSchema,
  deriveEventTitle,
  expandOccurrences,
  teamEventSchema,
  uuidSchema,
  type ParsedTeamEventInput,
  type TeamEventInput,
} from "@/lib/validation/team-schedule";
import { buildTeamIcs, type TeamIcsEvent } from "@/components/schedule/team-ics";
import { DalError, type SessionContext } from "./context";
import { insertBooking, type BookingConflict } from "./booking-engine";
import { canApproveBookings, canScheduleTeam, canViewTeam } from "./permissions";

const forbidden = () => new DalError("FORBIDDEN", "You do not have permission to do that.");

export type EventBookingStatus = "none" | "requested" | "approved" | "declined" | "cancelled";

export interface TeamEventView {
  id: string;
  teamId: string;
  teamName: string;
  teamColor: string | null;
  kind: "practice" | "game" | "event";
  /** Display title (override or derived: "Practice", "vs Brookings"). */
  title: string;
  rawTitle: string | null;
  startsAt: Date;
  endsAt: Date;
  status: "scheduled" | "cancelled";
  resourceId: string | null;
  resourceName: string | null;
  locationText: string | null;
  opponent: string | null;
  site: "home" | "away" | "neutral" | null;
  seriesId: string | null;
  notes: string | null;
  bookingId: string | null;
  bookingStatus: EventBookingStatus;
  /** Admin's reason when a request was declined (staff only). */
  decisionNote: string | null;
}

export interface FacilityOption {
  id: string;
  name: string;
  depth: number;
  kind: string;
}

// ---- helpers ---------------------------------------------------------------------

interface TeamRow {
  id: string;
  name: string;
  color: string | null;
  programId: string;
  seasonId: string;
  isActive: boolean;
}

async function loadTeam(tx: DbOrTx, teamId: string): Promise<TeamRow> {
  uuidSchema.parse(teamId);
  const [t] = await tx
    .select({
      id: teams.id,
      name: teams.name,
      color: teams.color,
      programId: teams.programId,
      seasonId: teams.seasonId,
      isActive: teams.isActive,
    })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!t) throw new DalError("NOT_FOUND", "Team not found.");
  return t;
}

/** Guardian of an athlete who is a live player on the team. */
async function isGuardianOfTeamPlayer(ctx: SessionContext, teamId: string, tx: DbOrTx = db): Promise<boolean> {
  const rows = await tx
    .select({ id: teamPlayers.id })
    .from(teamPlayers)
    .innerJoin(registrations, and(eq(registrations.id, teamPlayers.registrationId), isNull(registrations.deletedAt)))
    .innerJoin(athletes, and(eq(athletes.id, registrations.athleteId), isNull(athletes.deletedAt)))
    .innerJoin(householdGuardians, and(eq(householdGuardians.athleteId, athletes.id), eq(householdGuardians.userId, ctx.userId)))
    .where(and(eq(teamPlayers.teamId, teamId), isNull(teamPlayers.removedAt)))
    .limit(1);
  return rows.length > 0;
}

/** Team staff / program admin / board, or a guardian of a live player. */
async function assertCanViewSchedule(ctx: SessionContext, team: TeamRow): Promise<"staff" | "guardian"> {
  if (canViewTeam(ctx, team)) return "staff";
  if (await isGuardianOfTeamPlayer(ctx, team.id)) return "guardian";
  throw forbidden();
}

function conflictText(c: BookingConflict): string {
  return `${c.resourceName}: "${c.title}" ${formatTimeRange(c.startsAt, c.endsAt)}`;
}

function bookingTitle(teamName: string, e: Pick<ParsedTeamEventInput, "kind" | "title" | "opponent" | "site">): string {
  if (e.title) return `${teamName}: ${e.title}`;
  if (e.kind === "practice") return `${teamName} practice`;
  if (e.kind === "game") return e.opponent ? `${teamName} ${e.site === "away" ? "at" : "vs"} ${e.opponent}` : `${teamName} game`;
  return `${teamName} event`;
}

async function assertFacilityUsable(tx: DbOrTx, resourceId: string): Promise<void> {
  const [r] = await tx.select({ isActive: resources.isActive }).from(resources).where(eq(resources.id, resourceId)).limit(1);
  if (!r) throw new DalError("INVALID", "That facility does not exist.");
  if (!r.isActive) throw new DalError("INVALID", "That facility is not available for booking.");
}

const eventSelect = {
  id: teamEvents.id,
  teamId: teamEvents.teamId,
  teamName: teams.name,
  teamColor: teams.color,
  kind: teamEvents.kind,
  title: teamEvents.title,
  startsAt: teamEvents.startsAt,
  endsAt: teamEvents.endsAt,
  status: teamEvents.status,
  resourceId: teamEvents.resourceId,
  resourceName: resources.name,
  resourceAddress: resources.locationAddress,
  locationText: teamEvents.locationText,
  opponent: teamEvents.opponent,
  site: teamEvents.site,
  seriesId: teamEvents.seriesId,
  notes: teamEvents.notes,
  bookingId: teamEvents.bookingId,
  bookingStatus: resourceBookings.status,
  decisionNote: resourceBookings.decisionNote,
  updatedAt: teamEvents.updatedAt,
};

async function selectEvents(
  teamIds: string[],
  from: Date,
  to: Date,
  opts: { includeDecisionNote: boolean } = { includeDecisionNote: false }
) {
  if (teamIds.length === 0) return [];
  const rows = await db
    .select(eventSelect)
    .from(teamEvents)
    .innerJoin(teams, eq(teams.id, teamEvents.teamId))
    .leftJoin(resources, eq(resources.id, teamEvents.resourceId))
    .leftJoin(resourceBookings, eq(resourceBookings.id, teamEvents.bookingId))
    .where(and(inArray(teamEvents.teamId, teamIds), gte(teamEvents.startsAt, from), lt(teamEvents.startsAt, to)))
    .orderBy(asc(teamEvents.startsAt), asc(teamEvents.id));
  return rows.map((r) => ({ ...r, decisionNote: opts.includeDecisionNote ? r.decisionNote : null }));
}

type EventRow = Awaited<ReturnType<typeof selectEvents>>[number];

function toView(r: EventRow): TeamEventView {
  return {
    id: r.id,
    teamId: r.teamId,
    teamName: r.teamName,
    teamColor: r.teamColor,
    kind: r.kind,
    title: deriveEventTitle(r),
    rawTitle: r.title,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
    resourceId: r.resourceId,
    resourceName: r.resourceName,
    locationText: r.locationText,
    opponent: r.opponent,
    site: r.site,
    seriesId: r.seriesId,
    notes: r.notes,
    bookingId: r.bookingId,
    bookingStatus: r.bookingId ? (r.bookingStatus ?? "none") : "none",
    decisionNote: r.decisionNote,
  };
}

// ---- reads -------------------------------------------------------------------------

/** Active facilities in tree order (any signed-in scheduler may pick one). */
async function listFacilityOptions(): Promise<FacilityOption[]> {
  const rows = await db
    .select({ id: resources.id, name: resources.name, parentId: resources.parentResourceId, kind: resources.kind, sortOrder: resources.sortOrder })
    .from(resources)
    .where(eq(resources.isActive, true))
    .orderBy(asc(resources.sortOrder), asc(resources.name));
  const byParent = new Map<string | null, typeof rows>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    const key = r.parentId && ids.has(r.parentId) ? r.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const out: FacilityOption[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      out.push({ id: r.id, name: r.name, depth, kind: r.kind });
      if (depth < 8) walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export interface TeamScheduleContext {
  team: { id: string; name: string; color: string | null; programId: string; seasonId: string; isActive: boolean };
  program: { slug: string; name: string };
  viewer: "staff" | "guardian";
  canSchedule: boolean;
  /** Whether a booking this viewer creates is approved immediately (program admin / board). */
  autoApproves: boolean;
  /** Secret feed token; shown to staff and guardians who can already see the schedule. */
  calendarToken: string;
  facilities: FacilityOption[];
}

/** Header data for the team schedule page. Refuses unless the viewer may see the schedule. */
export async function getTeamScheduleContext(ctx: SessionContext, slug: string, teamId: string): Promise<TeamScheduleContext> {
  uuidSchema.parse(teamId);
  const [row] = await db
    .select({
      id: teams.id,
      name: teams.name,
      color: teams.color,
      programId: teams.programId,
      seasonId: teams.seasonId,
      isActive: teams.isActive,
      calendarToken: teams.calendarToken,
      programSlug: programs.slug,
      programName: programs.name,
    })
    .from(teams)
    .innerJoin(programs, eq(programs.id, teams.programId))
    .where(and(eq(teams.id, teamId), eq(programs.slug, slug), isNull(programs.deletedAt)))
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Team not found.");
  const viewer = await assertCanViewSchedule(ctx, row);
  const canSchedule = canScheduleTeam(ctx, row);
  return {
    team: { id: row.id, name: row.name, color: row.color, programId: row.programId, seasonId: row.seasonId, isActive: row.isActive },
    program: { slug: row.programSlug, name: row.programName },
    viewer,
    canSchedule,
    autoApproves: canApproveBookings(ctx, row.programId),
    calendarToken: row.calendarToken,
    facilities: canSchedule ? await listFacilityOptions() : [],
  };
}

/** Events with startsAt in [from, to). Team viewers or guardians of live players. */
export async function listTeamEvents(
  ctx: SessionContext,
  teamId: string,
  range: { from: Date; to: Date }
): Promise<TeamEventView[]> {
  const team = await loadTeam(db, teamId);
  const viewer = await assertCanViewSchedule(ctx, team);
  const rows = await selectEvents([team.id], range.from, range.to, { includeDecisionNote: viewer === "staff" });
  return rows.map(toView);
}

export interface MyScheduleEvent extends TeamEventView {
  /** My athletes (guardian) on this team, by name. */
  athletes: { id: string; name: string }[];
  /** My staff role on this team, if any. */
  staffRole: "head_coach" | "assistant_coach" | "team_manager" | null;
  programSlug: string;
}

export interface MyScheduleTeam {
  id: string;
  name: string;
  color: string | null;
  programSlug: string;
  calendarToken: string;
  athletes: { id: string; name: string }[];
  staffRole: "head_coach" | "assistant_coach" | "team_manager" | null;
}

export interface MySchedule {
  events: MyScheduleEvent[];
  teams: MyScheduleTeam[];
  athletes: { id: string; name: string }[];
}

/** Events for teams my athletes are on (live players) plus teams I staff. */
export async function listMySchedule(ctx: SessionContext, range: { from: Date; to: Date }): Promise<MySchedule> {
  const kids = await db
    .select({
      teamId: teams.id,
      athleteId: athletes.id,
      first: athletes.firstName,
      last: athletes.lastName,
    })
    .from(householdGuardians)
    .innerJoin(athletes, and(eq(athletes.id, householdGuardians.athleteId), isNull(athletes.deletedAt)))
    .innerJoin(registrations, and(eq(registrations.athleteId, athletes.id), isNull(registrations.deletedAt)))
    .innerJoin(teamPlayers, and(eq(teamPlayers.registrationId, registrations.id), isNull(teamPlayers.removedAt)))
    .innerJoin(teams, and(eq(teams.id, teamPlayers.teamId), eq(teams.isActive, true)))
    .where(eq(householdGuardians.userId, ctx.userId));

  const staffByTeam = new Map(ctx.teamStaff.map((t) => [t.teamId, t.role]));
  const teamIds = [...new Set([...kids.map((k) => k.teamId), ...staffByTeam.keys()])];
  if (teamIds.length === 0) return { events: [], teams: [], athletes: [] };

  const kidsByTeam = new Map<string, { id: string; name: string }[]>();
  const allKids = new Map<string, { id: string; name: string }>();
  for (const k of kids) {
    const a = { id: k.athleteId, name: `${k.first} ${k.last}` };
    allKids.set(a.id, a);
    const list = kidsByTeam.get(k.teamId) ?? [];
    if (!list.some((x) => x.id === a.id)) list.push(a);
    kidsByTeam.set(k.teamId, list);
  }

  const teamRows = await db
    .select({ id: teams.id, name: teams.name, color: teams.color, token: teams.calendarToken, slug: programs.slug })
    .from(teams)
    .innerJoin(programs, eq(programs.id, teams.programId))
    .where(and(inArray(teams.id, teamIds), eq(teams.isActive, true)));
  const slugByTeam = new Map(teamRows.map((t) => [t.id, t.slug]));

  const rows = await selectEvents(teamRows.map((t) => t.id), range.from, range.to, { includeDecisionNote: false });
  const events: MyScheduleEvent[] = rows.map((r) => ({
    ...toView(r),
    // Only staff see the admin's decision note; guardians' view of the same row stays blank.
    decisionNote: staffByTeam.has(r.teamId) ? r.decisionNote : null,
    athletes: kidsByTeam.get(r.teamId) ?? [],
    staffRole: staffByTeam.get(r.teamId) ?? null,
    programSlug: slugByTeam.get(r.teamId) ?? "",
  }));

  return {
    events,
    teams: teamRows
      .map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        programSlug: t.slug,
        calendarToken: t.token,
        athletes: kidsByTeam.get(t.id) ?? [],
        staffRole: staffByTeam.get(t.id) ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    athletes: [...allKids.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ---- writes ------------------------------------------------------------------------

export interface SkippedOccurrence {
  date: string;
  reason: string;
}

export interface CreateTeamEventResult {
  seriesId: string | null;
  /** "none" when the event has no facility (away / off-site). */
  bookingStatus: "none" | "requested" | "approved";
  created: { id: string; startsAt: Date }[];
  skipped: SkippedOccurrence[];
}

export async function createTeamEvent(ctx: SessionContext, teamId: string, raw: TeamEventInput | Record<string, unknown>): Promise<CreateTeamEventResult> {
  const input = teamEventSchema.parse(raw);
  const team = await loadTeam(db, teamId);
  if (!canScheduleTeam(ctx, team)) throw forbidden();
  if (!team.isActive) throw new DalError("INVALID", "This team is inactive.");
  const autoApprove = canApproveBookings(ctx, team.programId);

  return db.transaction(async (tx) => {
    if (input.resourceId) await assertFacilityUsable(tx, input.resourceId);
    const occurrences = expandOccurrences(input);
    const isSeries = !!input.recurrence;
    const seriesId = isSeries ? randomUUID() : null;
    const title = bookingTitle(team.name, input);

    const created: { id: string; startsAt: Date }[] = [];
    const skipped: SkippedOccurrence[] = [];
    const bookingIds: string[] = [];
    let bookingStatus: CreateTeamEventResult["bookingStatus"] = "none";

    for (const occ of occurrences) {
      if (!occ.startsAt || !occ.endsAt) {
        skipped.push({ date: occ.date, reason: "That local time does not exist on this date (daylight saving gap)." });
        continue;
      }
      let bookingId: string | null = null;
      if (input.resourceId) {
        const res = await insertBooking(tx, {
          resourceId: input.resourceId,
          programId: team.programId,
          title,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          createdByUserId: ctx.userId,
          seriesId,
          notes: input.notes,
          autoApprove,
        });
        if (!res.ok) {
          const text = res.conflicts.map(conflictText).join("; ");
          if (!isSeries) throw new DalError("INVALID", `That time conflicts with an existing booking (${text}). Choose another time or facility.`);
          skipped.push({ date: occ.date, reason: `Conflicts with ${text}` });
          continue;
        }
        bookingId = res.bookingId;
        bookingStatus = res.status;
        bookingIds.push(res.bookingId);
      }
      const [row] = await tx
        .insert(teamEvents)
        .values({
          teamId: team.id,
          kind: input.kind,
          title: input.title,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          resourceId: input.resourceId,
          bookingId,
          locationText: input.locationText,
          opponent: input.opponent,
          site: input.site,
          seriesId,
          notes: input.notes,
          createdByUserId: ctx.userId,
        })
        .returning({ id: teamEvents.id });
      created.push({ id: row.id, startsAt: occ.startsAt });
    }

    if (created.length === 0) {
      const why = skipped.slice(0, 3).map((s) => `${s.date}: ${s.reason}`).join(" | ");
      throw new DalError("INVALID", `No events could be created. ${why}`);
    }

    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "team_event.created",
        targetType: "team_event",
        targetId: created[0].id,
        metadata: {
          teamId: team.id,
          kind: input.kind,
          seriesId,
          count: created.length,
          skipped: skipped.length,
          resourceId: input.resourceId,
        },
      },
      tx
    );
    if (bookingIds.length > 0) {
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: autoApprove ? "booking.created" : "booking.requested",
          targetType: "booking",
          targetId: bookingIds[0],
          metadata: { teamId: team.id, resourceId: input.resourceId, seriesId, count: bookingIds.length, source: "team_event" },
        },
        tx
      );
    }
    return { seriesId, bookingStatus, created, skipped };
  });
}

/** Cancel (status) the booking if it still occupies / requests a facility. */
async function cancelBookingRows(tx: DbTx, ctx: SessionContext, bookingIds: string[]): Promise<string[]> {
  if (bookingIds.length === 0) return [];
  const now = new Date();
  const rows = await tx
    .update(resourceBookings)
    .set({ status: "cancelled", cancelledAt: now, cancelledByUserId: ctx.userId })
    .where(and(inArray(resourceBookings.id, bookingIds), inArray(resourceBookings.status, ["requested", "approved"])))
    .returning({ id: resourceBookings.id });
  return rows.map((r) => r.id);
}

export async function updateTeamEvent(
  ctx: SessionContext,
  eventId: string,
  raw: TeamEventInput | Record<string, unknown>
): Promise<{ id: string; bookingStatus: EventBookingStatus; rebooked: boolean }> {
  uuidSchema.parse(eventId);
  // Updates edit one occurrence; recurrence is a creation-time option.
  const input = teamEventSchema.parse({ ...raw, recurrence: null });

  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(teamEvents).where(eq(teamEvents.id, eventId)).for("update").limit(1);
    if (!ev) throw new DalError("NOT_FOUND", "Event not found.");
    const team = await loadTeam(tx, ev.teamId);
    if (!canScheduleTeam(ctx, team)) throw forbidden();
    if (!team.isActive) throw new DalError("INVALID", "This team is inactive.");
    if (ev.status === "cancelled") throw new DalError("INVALID", "This event was cancelled and can no longer be edited.");

    let oldBooking: { id: string; status: string } | null = null;
    if (ev.bookingId) {
      const [b] = await tx
        .select({ id: resourceBookings.id, status: resourceBookings.status })
        .from(resourceBookings)
        .where(eq(resourceBookings.id, ev.bookingId))
        .limit(1);
      oldBooking = b ?? null;
    }
    const bookingLive = oldBooking?.status === "requested" || oldBooking?.status === "approved";

    const placeChanged =
      ev.startsAt.getTime() !== input.startsAt.getTime() ||
      ev.endsAt.getTime() !== input.endsAt.getTime() ||
      ev.resourceId !== input.resourceId;
    // A declined / cancelled booking can be re-requested by saving the event again.
    const needsNewBooking = !!input.resourceId && (placeChanged || !bookingLive);

    let bookingId: string | null = ev.bookingId;
    let bookingStatus: EventBookingStatus = oldBooking ? (oldBooking.status as EventBookingStatus) : "none";
    const autoApprove = canApproveBookings(ctx, team.programId);
    const title = bookingTitle(team.name, input);

    if (placeChanged || needsNewBooking) {
      // Cancel first so the old (approved) booking cannot conflict with its own replacement.
      if (oldBooking) {
        const cancelled = await cancelBookingRows(tx, ctx, [oldBooking.id]);
        if (cancelled.length > 0) {
          await writeAudit(
            {
              actorUserId: ctx.userId,
              action: "booking.cancelled",
              targetType: "booking",
              targetId: oldBooking.id,
              metadata: { teamId: team.id, eventId: ev.id, reason: "rescheduled" },
            },
            tx
          );
        }
      }
      bookingId = null;
      bookingStatus = "none";
      if (input.resourceId) {
        await assertFacilityUsable(tx, input.resourceId);
        const res = await insertBooking(tx, {
          resourceId: input.resourceId,
          programId: team.programId,
          title,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdByUserId: ctx.userId,
          seriesId: ev.seriesId,
          notes: input.notes,
          autoApprove,
        });
        if (!res.ok) {
          throw new DalError("INVALID", `That time conflicts with an existing booking (${res.conflicts.map(conflictText).join("; ")}). Nothing was changed.`);
        }
        bookingId = res.bookingId;
        bookingStatus = res.status;
        await writeAudit(
          {
            actorUserId: ctx.userId,
            action: autoApprove ? "booking.created" : "booking.requested",
            targetType: "booking",
            targetId: res.bookingId,
            metadata: { teamId: team.id, resourceId: input.resourceId, eventId: ev.id, source: "team_event_update" },
          },
          tx
        );
      }
    } else if (oldBooking) {
      // Same slot: keep the booking, refresh its label / notes.
      await tx.update(resourceBookings).set({ title, notes: input.notes }).where(eq(resourceBookings.id, oldBooking.id));
    }

    await tx
      .update(teamEvents)
      .set({
        kind: input.kind,
        title: input.title,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        resourceId: input.resourceId,
        bookingId,
        locationText: input.locationText,
        opponent: input.opponent,
        site: input.site,
        notes: input.notes,
      })
      .where(eq(teamEvents.id, ev.id));

    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "team_event.updated",
        targetType: "team_event",
        targetId: ev.id,
        metadata: { teamId: team.id, rescheduled: placeChanged, rebooked: placeChanged || needsNewBooking, resourceId: input.resourceId },
      },
      tx
    );
    return { id: ev.id, bookingStatus, rebooked: placeChanged || needsNewBooking };
  });
}

export async function cancelTeamEvent(
  ctx: SessionContext,
  eventId: string,
  opts: { scope: "one" | "future" }
): Promise<{ cancelled: number }> {
  uuidSchema.parse(eventId);
  const scope = cancelScopeSchema.parse(opts.scope);

  return db.transaction(async (tx) => {
    const [ev] = await tx.select().from(teamEvents).where(eq(teamEvents.id, eventId)).for("update").limit(1);
    if (!ev) throw new DalError("NOT_FOUND", "Event not found.");
    const team = await loadTeam(tx, ev.teamId);
    if (!canScheduleTeam(ctx, team)) throw forbidden();
    if (ev.status === "cancelled") throw new DalError("INVALID", "This event is already cancelled.");

    const targets =
      scope === "future" && ev.seriesId
        ? await tx
            .select({ id: teamEvents.id, bookingId: teamEvents.bookingId })
            .from(teamEvents)
            .where(
              and(
                eq(teamEvents.teamId, ev.teamId),
                eq(teamEvents.seriesId, ev.seriesId),
                eq(teamEvents.status, "scheduled"),
                gte(teamEvents.startsAt, ev.startsAt)
              )
            )
            .for("update")
        : [{ id: ev.id, bookingId: ev.bookingId }];

    const now = new Date();
    await tx
      .update(teamEvents)
      .set({ status: "cancelled", cancelledAt: now, cancelledByUserId: ctx.userId })
      .where(inArray(teamEvents.id, targets.map((t) => t.id)));

    const cancelledBookings = await cancelBookingRows(
      tx,
      ctx,
      targets.map((t) => t.bookingId).filter((b): b is string => !!b)
    );
    if (cancelledBookings.length > 0) {
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "booking.cancelled",
          targetType: "booking",
          targetId: cancelledBookings[0],
          metadata: { teamId: team.id, count: cancelledBookings.length, seriesId: ev.seriesId, reason: "event cancelled" },
        },
        tx
      );
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "team_event.cancelled",
        targetType: "team_event",
        targetId: ev.id,
        metadata: { teamId: team.id, scope, count: targets.length, seriesId: ev.seriesId },
      },
      tx
    );
    return { cancelled: targets.length };
  });
}

// ---- public ICS feed -----------------------------------------------------------------

const FEED_PAST_MS = 30 * 86_400_000;
const FEED_FUTURE_MS = 365 * 86_400_000;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

function icsSummary(teamName: string, r: EventRow, bookingStatus: EventBookingStatus): { summary: string; cancelled: boolean } {
  let base: string;
  if (r.title) base = `${teamName}: ${r.title}`;
  else if (r.kind === "practice") base = `${teamName} practice`;
  else if (r.kind === "game") base = r.opponent ? `${teamName} ${r.site === "away" ? "at" : "vs"} ${r.opponent}` : `${teamName} game`;
  else base = `${teamName} event`;

  let cancelled = r.status === "cancelled";
  if (cancelled) return { summary: `[Cancelled] ${base}`, cancelled };
  if (bookingStatus === "requested") base += " (field pending)";
  else if (bookingStatus === "declined" || bookingStatus === "cancelled") {
    // The facility request was turned down: the event can't happen there as planned.
    base += " (field declined)";
    cancelled = true;
  }
  return { summary: base, cancelled };
}

/**
 * Public by secret token (no session): returns the ICS body for the team whose
 * calendarToken matches EXACTLY, or null (-> 404). Covers the last 30 days
 * through the next 365 days. No athlete data is read or emitted.
 */
export async function getTeamCalendarFeed(token: string, now: Date = new Date()): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  const [team] = await db
    .select({ id: teams.id, name: teams.name, isActive: teams.isActive })
    .from(teams)
    .where(and(eq(teams.calendarToken, token), eq(teams.isActive, true)))
    .limit(1);
  if (!team) return null;

  const rows = await selectEvents([team.id], new Date(now.getTime() - FEED_PAST_MS), new Date(now.getTime() + FEED_FUTURE_MS));
  const events: TeamIcsEvent[] = rows.map((r) => {
    const bookingStatus: EventBookingStatus = r.bookingId ? (r.bookingStatus ?? "none") : "none";
    const { summary, cancelled } = icsSummary(team.name, r, bookingStatus);
    const location = r.resourceName ? (r.resourceAddress ? `${r.resourceName}, ${r.resourceAddress}` : r.resourceName) : r.locationText;
    return {
      id: r.id,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      summary,
      location,
      description: r.notes,
      cancelled,
      updatedAt: r.updatedAt,
    };
  });
  return buildTeamIcs({ id: team.id, name: team.name }, events, now);
}
