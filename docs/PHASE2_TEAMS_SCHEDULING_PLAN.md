# Phase 2 Plan: Teams, facility scheduling, team-scoped coach access, insurance export

This plan binds the parallel workers. Invariants live in `AGENT_HANDOFF.md`; numbers 1, 3, 4, 8 and 9 matter most here.

Conventions still apply:
- DAL functions take `ctx` first and authorize inside the function.
- Actions follow zod → `runAction` → `revalidatePath` → `ActionResult`.
- Forms use `useActionForm`.
- UI uses only `src/components/ui/*`.
- **All times are entered and displayed in America/Los_Angeles.** Use `laDateTimeInputToUtc`, `formatTimeRange` and similar helpers.
- No page may overflow horizontally at 390px.

## User decisions
- **Coaches see only their own team.** Team staff (`team_staff`) see their team's roster, emergency sheet and schedule. Program admins and the board see every team. **The whole-season roster and season emergency sheet become program-admin and board only.**
- **Coaches request field time; admins approve.** Head coaches and team managers request time. Program admins and the board book directly and approve or decline requests. Double-booking is always blocked, including across the facility tree.
- **Parents see their child's team schedule**, in the app and as a calendar feed.

## 0. Done by the orchestrator (read it, don't redo it)
- **Schema** (migration `0011`):
  - `resources`: new `kind` (`complex | field | gym | court | cage | mat | room | other`) and `sortOrder` columns.
  - `resource_bookings`:
    - `status` is `requested | approved | declined | cancelled`, and **only `approved` occupies a facility**.
    - New columns: `seriesId`, `notes`, `decidedBy/At`, `decisionNote`, `cancelledAt/By`, `updatedAt`.
    - New check constraint: `endsAt > startsAt`.
  - New `src/db/schema/teams.ts` tables:
    - `teams`: `seasonId`, `programId` (denormalised), `name` (unique per season, case-insensitive), `division`, `color` (`#RRGGBB`), `calendarToken` (unique secret for the ICS feed), `isActive`.
    - `team_players`: one row per live registration. One live team per registration, with history kept via `removedAt`. Also holds `jerseyNumber`.
    - `team_staff`: `role` is `head_coach | assistant_coach | team_manager`. One live row per (team, user), with history via `removedAt`.
    - `team_events`:
      - `kind` is `practice | game | event`. `status` is `scheduled | cancelled`.
      - Columns: `resourceId` and `bookingId` (for our facilities), `locationText` (away or off-site), `opponent`, `site` (`home | away | neutral`), `seriesId`, `notes`.
      - Check constraint: `bookingId` requires `resourceId`.
- **`SessionContext.teamStaff`** is a list of `{ teamId, programId, seasonId, role }` for live staff rows on active teams. It's loaded on every request.
- **`src/lib/dal/permissions.ts`** adds:
  - `canViewProgramHub(ctx, programId)`: board, any program role, or team staff in that program.
  - `canViewSeasonRoster(ctx, programId)`: board or program admin. Use this for **whole-season** roster and emergency access.
  - `canViewTeam(ctx, { id, programId })`: program admin, board, or staff on that team.
  - `canScheduleTeam(ctx, team)`: program admin, board, or the team's head coach or team manager.
  - `canApproveBookings(ctx, programId | null)`: program admin of that program, or board.
  - `canManageFacilities(ctx)`: board.
  - `hasTeams(ctx)`.
  - `canViewRoster` stays as it was (board or program staff role). **It must no longer gate season-level medical or roster data** (see R1).
- **`src/lib/dal/booking-engine.ts`** is shared and tested, including a race test (3 concurrent approvals give 1 winner):
  - `lockFacilityTree(tx, resourceId)`: takes a transaction-scoped advisory lock on the tree root.
  - `relatedResourceIds`, which covers the node, its ancestors and its descendants.
  - `findBookingConflicts(tx, { resourceId, startsAt, endsAt, excludeBookingId? })`: returns **approved** bookings only, using half-open intervals.
  - `insertBooking(tx, { …, autoApprove })`: locks the tree, refuses on conflict, and creates the booking as requested or approved.
  - **Every path that approves a booking must call `lockFacilityTree` and `findBookingConflicts` in the same transaction before setting the booking to approved.**
- **Nav:**
  - "Schedule" (`/schedule`) in My family.
  - "My teams" (`/teams`, shown when `hasTeams`) in Programs.
  - "Facilities" (`/admin/facilities`) in Administration.
  - The middleware protects `/teams/*` and `/schedule/*`.
- **Service worker:** `EMERGENCY_PATH` now also matches `/programs/<slug>/teams/<id>/emergency`, so team sheets and their photos work offline.
- **Audit:** new `team.*`, `facility.*`, `booking.*`, `team_event.*` and `roster.exported` actions, plus new targets.

## 1. Workstreams (parallel, no file overlap)

### T1 — Team management
**Owns:**
- `src/lib/validation/teams.ts` and `src/lib/dal/teams.ts`
- `src/app/(portal)/programs/[slug]/seasons/[seasonId]/teams/**`: the season's team builder, for program admins
- `src/app/(portal)/programs/[slug]/teams/[teamId]/page.tsx` and `actions.ts`: the team overview
- `src/app/(portal)/teams/**`: "My teams"
- `src/components/teams/**`

**DAL:**
- **Teams** (all `canManageProgram`):
  - `listSeasonTeams(ctx, seasonId)`: player and staff counts per team.
  - `createTeam(ctx, seasonId, { name, division?, color? })`: generates `calendarToken` as 32 random bytes in base64url.
  - `updateTeam` covers name, division, color and isActive.
  - `rotateCalendarToken`.
- **Players:**
  - `listUnassignedRegistrations(ctx, seasonId)`: live registrations with no live team. Return athlete name, age and the season's custom answers, so admins can filter by e.g. division. Never return medical data.
  - `assignPlayers(ctx, teamId, registrationIds[])`:
    - Run in one transaction. Lock the registration rows `FOR UPDATE`.
    - Each registration must belong to the team's season and be live.
    - Moving a player from another team ends the old row and inserts a new one.
    - Audit each change.
  - `removePlayer(ctx, teamPlayerId)` and `setJerseyNumber`.
- **Staff:**
  - `addTeamStaff(ctx, teamId, { email, role })`: the user must already exist.
  - Return a **credential readiness** list against the program's `requiredCredentialIds` (verified and unexpired). Warn about gaps but don't block.
  - `removeTeamStaff`.
  - Suggest people from existing program roles: anyone with `head_coach` or `assistant_coach` in `program_roles` or an approved volunteer role assignment.
- **`getTeamOverview(ctx, teamId)`** (`canViewTeam`):
  - Team info and staff with their credential readiness.
  - Roster: athlete name, age, jersey number, `photoUrl` (from `athletePhotoUrl` in `photos.ts`), and guardian names and phones for `receivesComms` guardians. **No medical notes.**
  - Links to `schedule` and `emergency` (built by S2 and R1).
  - Audit `roster.viewed` once per call.
- **`listMyTeams(ctx)`:** the teams where I'm staff, plus all active teams in programs I admin (or every team for the board), with the next event if any. Read events from `team_events` directly (S2 owns writes).

**UI:**
- **Season team builder:**
  - A team cards grid with create and edit modals.
  - An unassigned-players panel with a search and division filter, multi-select, and "Assign to team".
  - Move a player between teams with a select.
  - Staff add (email or suggestion) and remove.
- **Team overview:**
  - A header with color, division and staff.
  - A roster table that becomes cards on mobile.
  - Tabs: Overview, Schedule (`/programs/[slug]/teams/[id]/schedule`) and Emergency (`.../emergency`).
- **`/teams`:** cards for my teams.

### S1 — Facilities and booking approvals
**Owns:**
- `src/lib/validation/facilities.ts`
- `src/lib/dal/facilities.ts`: rewrite it. Remove the old `ctx`-less `checkResourceConflict` and use the engine.
- `src/app/(admin)/admin/facilities/**`
- `src/app/(portal)/programs/[slug]/schedule/**`: the program schedule and requests
- `src/components/facilities/**`
- **Don't edit** `booking-engine.ts`. Report it if you need a change.

**DAL:**
- **Facility tree** (`canManageFacilities`):
  - `listFacilities(ctx)`: returns the tree. Any signed-in user may read active facilities, for pickers.
  - `createFacility(ctx, { name, kind, parentId?, locationAddress?, notes? })`.
  - `updateFacility`, including re-parenting. **Refuse cycles** (a node can't move under its own descendant).
  - `deactivateFacility`. Refuse if future approved bookings exist, or offer to show them.
  - Sort with `sortOrder`.
- **Direct bookings** (`canApproveBookings` for the program, or board when `programId` is null, e.g. a maintenance block):
  - `createDirectBooking(ctx, { resourceId, programId?, title, startsAt, endsAt, notes? })` uses `insertBooking` with `autoApprove: true`.
- **Approvals:**
  - `listBookingRequests(ctx, { scope: { all } | { programId }, status })`: pending requests first. Show the conflicts each would hit if approved now, computed with `findBookingConflicts`.
  - `approveBooking(ctx, id, note?)`:
    1. In a transaction, lock the booking row and `lockFacilityTree`.
    2. Re-check conflicts with `excludeBookingId`, and refuse with the conflict list if any.
    3. Set `approved`, `decidedBy` and `decidedAt`.
    4. Audit.
  - `approveSeries(ctx, seriesId)`: approve every non-conflicting requested occurrence and return the ones that conflicted.
  - `declineBooking(ctx, id, reason)`: reason is required.
  - `cancelBooking(ctx, id, reason)`: approvers, or the requester while it's still `requested`.
  - The linked `team_events` keep their own status. S2 shows the booking status alongside, so **don't** edit `team_events` here.
- **`getFacilityCalendar(ctx, { from, to, rootId?, programId? })`:**
  - Approved and requested bookings in the range.
  - Requested bookings appear as tentative.
  - Show team name or color when the booking is linked to a team event (read-only join).

**UI:**
- **`/admin/facilities`** has three tabs:
  - **Facilities:** a tree editor (add a child, rename, kind, move, deactivate).
  - **Calendar:** a week view of facilities as rows by time. On mobile, use a day list instead.
  - **Requests:** the board's approval queue across all programs, with a conflict preview and approve, decline, and approve-series actions.
- **`/programs/[slug]/schedule`** (for that program's admins): the program's requests queue, a direct-booking form, and the program's calendar.

### S2 — Team schedules, parent schedule and ICS feeds
**Owns:**
- `src/lib/validation/team-schedule.ts` and `src/lib/dal/team-schedule.ts`
- `src/app/(portal)/programs/[slug]/teams/[teamId]/schedule/**`
- `src/app/(portal)/schedule/**`
- `src/app/calendar/team/[token]/route.ts`
- `src/components/schedule/**`

**DAL:**
- **`listTeamEvents(ctx, teamId, { from, to })`:**
  - Allowed for `canViewTeam`, **or** a guardian of an athlete with a live `team_players` row on the team.
  - Each event carries its booking status: none, requested, approved, declined or cancelled.
- **`createTeamEvent(ctx, teamId, input)`** (`canScheduleTeam`):
  - Fields: `kind`, LA start and end, and one of `resourceId` (our facility) or `locationText`. For games, also `opponent` and `site`. Optional `title` and `notes`.
  - Recurrence: `{ weekdays: 0-6[], until: date }`, practices only, at most 60 occurrences. Every occurrence shares one `seriesId` across `team_events` and `resource_bookings`.
  - **Bookings:** when a `resourceId` is given, create the booking in the same transaction via `insertBooking`. Set `autoApprove` to `canApproveBookings(ctx, team.programId)`, set `programId` to the team's program, and use a title like "Pirates practice" or "Pirates vs Brookings".
  - **Conflicts:** a conflict on a single event refuses with the details. For a series, skip the conflicting dates, create the rest, and return the skipped list.
  - **Games:** home games require a `resourceId`; away games require `locationText`.
- **`updateTeamEvent`:** if the time or facility changes, cancel the old booking and create a new one via `insertBooking` in the same transaction. Otherwise update in place.
- **`cancelTeamEvent(ctx, id, { scope: "one" | "future" })`:** cancels the linked bookings and audits it.
- **`listMySchedule(ctx, { from, to })`:**
  - Events for teams where my athletes have live `team_players` rows, plus teams I staff.
  - Each event shows which of my athletes it's for.
  - Cancelled events are shown struck through.
- **ICS feed, `GET /calendar/team/[token]`:**
  - Public by secret token. The token must match exactly; an unknown token returns 404.
  - Events cover the last 30 days through the next 365 days.
  - Each event carries UID, DTSTAMP, start and end in UTC, a SUMMARY, the facility name or address as LOCATION, and `STATUS:CANCELLED` for cancelled events.
  - Show "(field pending)" in the summary while the booking is requested. Leave declined events out, or mark them cancelled.
  - `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: private, max-age=300`.
  - **No athlete data in the feed.**

**UI:**
- **Team schedule page:** a list grouped by week with booking-status badges (Requested, Confirmed, Declined). Add, edit and cancel controls for people who can schedule. A recurrence picker. A "Subscribe" panel with the `webcal://` and https feed URLs for staff and guardians. Regenerating the token is T1's `rotateCalendarToken`; link to it from the team overview.
- **`/schedule` for parents:** the upcoming 4 weeks by day, filterable by athlete, with subscribe links for each team.

### R1 — Access migration, team emergency sheet, insurance export
**Owns:** edits to these files:
- `src/lib/dal/rosters.ts`
- `src/lib/dal/photos.ts`
- `src/lib/dal/seasons.ts`, **only** the `getProgramHub` and `listMyStaffPrograms` access checks and the payload flags
- `src/lib/dal/registrations.ts`, **only** the `getSignedWaiver` staff check
- `src/lib/dal/volunteer-roles.ts`, **only** read access checks
- `src/app/(portal)/programs/[slug]/page.tsx`: the hub

New files:
- `src/app/(portal)/programs/[slug]/teams/[teamId]/emergency/**`
- `src/lib/dal/insurance-export.ts`
- `src/app/(portal)/programs/[slug]/seasons/[seasonId]/insurance/**`: `page.tsx` (printable) and `export/route.ts` (CSV)
- `src/components/insurance/**`

**Access migration:**
- `listSeasonRegistrations` and the season `getEmergencySheet` → `canViewSeasonRoster`.
- `canViewAthletePhoto` allows:
  - a guardian;
  - the board;
  - a program admin (`canManageProgram`) of a program with a live registration for the athlete;
  - team staff of a team with a live `team_players` row for one of the athlete's live registrations.
- `getProgramHub` → `canViewProgramHub`. Its payload sets `canViewSeasonRoster` and lists the viewer's own teams. The **hub UI hides** the season Registrations and Emergency links from non-admins and shows "Your teams" links instead, or "You're not assigned to a team yet".
- `getSignedWaiver`: allowed for a guardian, `canViewSeasonRoster`, or staff of a team the athlete is on.
- Volunteer roles **read-only** pages → `canViewProgramHub`.
- Audit every place `canViewRoster` is still used (`grep`), and replace it wherever it gates roster or medical data.

**Team emergency sheet:**
- `getTeamEmergencySheet(ctx, teamId)` (`canViewTeam`) returns the same shape as the season sheet, limited to the team's live players. Write **one** `medical.viewed` row with `{ teamId, athleteCount }`.
- The page reuses `EmergencySheetView` and `RegisterSw`. The service worker path is already updated.

**Insurance export** (`canViewSeasonRoster`; per season, filterable by team):
- **Players:** last name, first name, date of birth, age at season start (`startsOn`, else today), gender, team, division, jersey number, primary guardian name, guardian phone and guardian email.
- **Staff:** name, role, team, email, phone, and for each of the program's required credentials its status and expiry. Default to the first-advantage background check and SafeSport columns when none are configured.
- **CSV:** use `src/lib/csv.ts` (`toCsv`, which guards against formula injection). The file is `gbys-insurance-<program>-<season>.csv`.
- **Printable page:** org header from branding, the season, and the generated time in LA. It must be `print:hidden`-friendly.
- **Audit:** `roster.exported` with the format, counts and team filter.
- **Headers:** `Cache-Control: no-store`.

## 2. Shared rules
- **Ownership:**
  - Touch only the files you own.
  - Never edit the schema, migrations, `context.ts`, `permissions.ts`, `booking-engine.ts`, nav files, `middleware.ts`, `next.config.ts`, `public/sw.js` or `audit.ts`. Report anything you need there.
- **Build isolation:** run with `NEXT_DIST_DIR=.next-<ws>`. Afterwards, `git checkout tsconfig.json`. Leave no processes running.
- **Database:**
  - Use your own `gbys_<ws>` on localhost:5432 (postgres/postgres). If it's down, run `pg_ctlcluster 16 main start`.
  - Set it up with `DATABASE_URL=... npm run db:migrate:prod && npm run db:seed`.
  - Insert SQL fixtures with real `gen_random_uuid()` ids, since the zod uuid check rejects fake ones.
  - Never write `.env`. Drop the database when you're done.
- **Verification:**
  - Run `npx tsc --noEmit` and `next build`.
  - Write a DAL test, including races where relevant: concurrent `assignPlayers` of one registration to two teams gives one live row, and concurrent approvals give one winner.
  - Do a Playwright pass with the magic-link dev login, spacing out sign-ins.
  - Check 390px widths.
  - Keep scripts in the scratchpad.
- **Git:** don't commit or push. Report the files, deviations and verification, concisely.
