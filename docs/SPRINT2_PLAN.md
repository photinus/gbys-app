# Sprint 2 Implementation Plan (Volunteer Shifts, Hours Ledger, Grant Engine, Compliance Cron)

The binding source for parallel workers. Invariants are in `AGENT_HANDOFF.md` (4, 7 and 9 matter most). Sprint 1 conventions in `docs/SPRINT1_PLAN.md` still apply: the DAL takes `ctx` first and checks authorization itself; actions use zod → `runAction` → `revalidatePath` → `ActionResult`; forms use `useActionState` or the `useActionForm` pattern in `src/components/household/use-action-form.ts`; UI is built only from `src/components/ui/*` in the mockup style.

## 0. Already done by the orchestrator (read it; don't redo it)

- **Schema** (`src/db/schema/volunteers.ts`, migrations `drizzle/0001_*` and `0002_*`):
  - `volunteer_shifts`:
    - Single-assignee columns removed.
    - New columns: `location`, `createdByUserId`, `cancelledAt` and `updatedAt`.
    - Check constraints: `ends > starts` and `spots >= 1`.
  - New `volunteer_shift_signups` table:
    - Columns: `shiftId`, `userId`, `signedUpAt`, `cancelledAt`, `checkedInAt`, `checkedInByUserId` and `volunteerLogId`.
    - Unique on `(shiftId, userId)`. Re-signing up clears `cancelledAt` on the same row.
  - `volunteer_logs`:
    - New columns: `createdByUserId`, `approvedAt`, `deletedByUserId` and `deletionReason`.
    - Duration check: `0 < minutes <= 1440`.
    - Partial unique index: one live entry per `(shiftId, userId)`.
  - `user_credentials`: new columns `expiryWarning30SentAt` and `expiryWarning7SentAt`.
  - No Drizzle `relations()` exist for the volunteer tables. Use core `select().from().innerJoin()` queries, and use `alias(users, ...)` when you need several user joins.
- **Ledger rules (invariant 7).** Never change hours, dates or category on a ledger row, and never hard-delete one. Allowed mutations:
  - Approve: set `verificationMethod` from `self_reported` to `admin_approved`, and set `approvedByUserId` and `approvedAt`.
  - Soft delete or reject: set `deletedAt`, `deletedByUserId` and `deletionReason`.
  - Corrections: soft-delete the row, then add a new one.
- **`src/lib/audit.ts`:** new `AuditAction` and `AuditTarget` values for programs, shifts, hours, grants and cron. Use them exactly as defined there.
- **`src/lib/format.ts` additions:**
  - `laDateTimeInputToUtc("YYYY-MM-DDTHH:mm")` and `utcToLaDateTimeInput(d)`
  - `formatTime`, `formatTimeRange(start, end)`, `formatHours(minutes)` and `formatCents(cents)`
- **`src/lib/grant-rate.ts`:** `currentInKindRateCents()` reads env `DEFAULT_IN_KIND_HOURLY_RATE_CENTS` (fallback 3349) and is server-only. `inKindValueCents(minutes, rateCents)`.
- **`src/lib/volunteer-categories.ts`** (client-safe): `VOLUNTEER_CATEGORIES`, `CATEGORY_LABELS`, `VERIFICATION_METHODS` and `VERIFICATION_LABELS`.
- **`src/lib/dal/permissions.ts`:**
  - `canManageShifts(ctx, programId | null)`: board, or `program_admin` of that program. An org-wide (`null`) shift is board-only.
  - `canCheckIn(ctx, programId | null)`: `canManageShifts`, or `head_coach` / `team_manager` of that program.
  - `checkInProgramIds(ctx)`: returns `"all"` or a list of program ids.
  - `isShiftCoordinator(ctx)`
- **`src/lib/dal/programs.ts`:** `listActivePrograms(ctx): ProgramOption[]` (`{ id, name, slug, sport }`), open to any signed-in user. Use it for every program dropdown.
- **Nav and shell:** every Sprint 2 route is already in `src/components/shell/nav.ts`. Members see `/volunteer/shifts` and `/volunteer/hours`. Coordinators and board see `/volunteer/shifts/manage`. Board also sees `/admin/hours`, `/admin/grants` and `/admin/programs`. The shell is `print:hidden`. Do not edit the shell, the nav or the layouts.

## 1. Workstreams (run in parallel; no file overlap)

### WA: Programs and program roles (board admin)
**Owns:**
- `src/lib/validation/programs.ts`
- `src/lib/dal/programs.ts` (extend it; keep `listActivePrograms` unchanged)
- `src/app/(admin)/admin/programs/**`
- `src/components/programs/**`

**DAL:**
- `listProgramsAdmin(ctx)`: includes inactive programs and counts of roles.
- `getProgramAdmin(ctx, id)`
- `createProgram(ctx, input)`:
  - Input fields: name, slug, sport, description, `isIndependentPartner`, and `requiredCredentialIds` (multi-select of credential definitions).
  - Slug is lowercase kebab-case and unique; a duplicate gives `DalError INVALID`.
  - Audit `program.created`.
- `updateProgram(ctx, id, input)`: also takes `isActive`; audit `program.updated`.
- `listProgramRoles(ctx, programId)`: returns user name, email, role and season (seasons may be null).
- `grantProgramRole(ctx, { programId, email, role })`:
  - The user must already exist (they signed in once). Otherwise return the error "Ask them to sign in once first".
  - A duplicate (user, program, role) is refused.
  - Audit `program_role.granted`.
- `revokeProgramRole(ctx, roleId)`: audit `program_role.revoked`.

Every function is board-only and checks `isBoard` inside. Stripe fields are out of scope (Sprint 3); show `stripeOnboardingComplete` as read-only text.

**UI:**
- `/admin/programs`: a table plus a "New program" modal.
- `/admin/programs/[id]`: edit form, the required-credentials picker, and a roles table with grant (email plus role select) and revoke.

### WB: Shifts (sign-up, coordinator management, kiosk check-in)
**Owns:**
- `src/lib/validation/shifts.ts`
- `src/lib/dal/shifts.ts`
- `src/app/(portal)/volunteer/shifts/**`: `page.tsx`, `actions.ts`, `manage/page.tsx`, `manage/actions.ts`, and `[id]/page.tsx` for the roster and check-in
- `src/components/shifts/**`

**Member DAL:**
- `listUpcomingShifts(ctx, { programId?, includePast? })`:
  - Returns shifts that are not cancelled and have `endsAt > now`, ascending by start.
  - Each row has `spotsFilled` (count of live signups), `mySignupId` and `myStatus`.
- `listMyShifts(ctx)`: my upcoming and recent signups.
- `signUpForShift(ctx, shiftId)`:
  - Runs in a transaction and locks the shift `FOR UPDATE`.
  - Refused if the shift is cancelled or already started, or if live signups ≥ `spotsTotal`.
  - Upserts the signup row, clearing `cancelledAt`.
  - Audit `shift.signed_up`.
- `cancelMySignup(ctx, signupId)`:
  - Only my own signup, only before the start, and not once checked in.
  - Audit `shift.signup_cancelled`.

**Coordinator DAL:**
- `listManageableShifts(ctx, { range: "upcoming" | "past" })`: scoped by `checkInProgramIds`.
- `createShift(ctx, input)`:
  - Requires `canManageShifts(ctx, input.programId ?? null)`.
  - Times come from datetime-local inputs through `laDateTimeInputToUtc`. End must be after start, and the shift must be at most 24 h.
  - Audit `shift.created`.
- `updateShift(ctx, id, input)`: spots can't drop below the live signups; audit `shift.updated`.
- `cancelShift(ctx, id)`: sets `cancelledAt`, with no hard delete; audit `shift.cancelled`.
- `getShiftRoster(ctx, shiftId)`:
  - Requires `canCheckIn`.
  - Returns the shift plus signups: name, email, `signedUpAt`, `checkedInAt` and `checkedInBy`.
- `checkInSignup(ctx, signupId)`:
  - Requires `canCheckIn`.
  - Allowed window: from 2 h before start to 7 days after end.
  - In one transaction: lock the signup row; refuse if it is cancelled or already checked in; insert into `volunteer_logs`; set `checkedInAt`, `checkedInByUserId` and `volunteerLogId`.
  - The ledger entry has `verificationMethod: "shift_checkin"`, `durationMinutes` = the shift length, `activityDate = startsAt`, the shift's `category` and `programId`, `shiftId`, `createdByUserId` and `approvedByUserId` = ctx user, `approvedAt` = now, and `inKindRateCents: currentInKindRateCents()`.
  - Audit `shift.checked_in`.
- `undoCheckIn(ctx, signupId, reason)`:
  - Requires `canCheckIn`; reason is required.
  - In one transaction: soft-delete the linked log (setting `deletedBy` and `deletionReason`), then clear `checkedInAt`, `checkedInByUserId` and `volunteerLogId`.
  - Audit `shift.checkin_undone`.
- Walk-ins: `addWalkInAndCheckIn(ctx, shiftId, email)`.
  - Requires `canCheckIn`, and the user must exist.
  - Creates or revives the signup even when the shift is full, then checks in.

**UI:**
- `/volunteer/shifts`: shift cards or table with a program filter, and sign-up and cancel buttons.
- "My shifts" section on the same page.
- `/volunteer/shifts/manage`: a list with create, edit and cancel modals (program select limited to programs ctx can manage, plus "Org-wide" for board).
- `/volunteer/shifts/[id]`: a big-button kiosk roster (tablet-friendly) with check-in, undo with a reason, and walk-in.
- Show times with `formatTimeRange`.

### WC: Hours ledger (self-report, board review, dashboard)
**Owns:**
- `src/lib/validation/hours.ts`
- `src/lib/dal/volunteer-hours.ts`
- `src/app/(portal)/volunteer/hours/**`
- `src/app/(admin)/admin/hours/**`
- `src/components/hours/**`
- `src/app/(portal)/dashboard/page.tsx` (edit)

**Member DAL:**
- `logMyHours(ctx, input)`:
  - Fields: `programId` (optional; null = org/board), `category`, `activityDate` (YYYY-MM-DD in LA; not in the future; within the last 365 days), `durationMinutes` (15-minute steps, 15–1440; the form takes hours and minutes), and `description` (required, ≤ 500 characters).
  - Store `activityDate = laDateInputToUtc(date, false)` (local midnight), `self_reported`, `createdByUserId` = self, and `inKindRateCents` = current rate.
  - Audit `hours.logged`.
- `listMyHours(ctx, { year })`: excludes soft-deleted rows, but shows my rejected rows separately with the reason.
- `getMyHoursSummary(ctx)`: YTD (LA calendar year) verified minutes and pending minutes.
- `withdrawMyHours(ctx, logId)`:
  - Only my own `self_reported` unapproved entry.
  - Soft-delete with reason "Withdrawn by volunteer".
  - Audit `hours.deleted`.

**Board DAL (board-only, checked inside):**
- `listPendingHours(ctx)`: `self_reported`, not deleted, oldest first, with volunteer and program names.
- `approveHours(ctx, logId)`:
  - Refused for your own entry or an entry that isn't pending.
  - Audit `hours.approved`.
- `rejectHours(ctx, logId, reason)`: soft-delete with the reason; audit `hours.rejected`.
- `logHoursForVolunteer(ctx, { email, ...input })`:
  - Creates an `admin_approved` entry directly, with `approvedBy` = ctx and `createdBy` = ctx.
  - Audit `hours.logged` with metadata `{ onBehalfOf }`.

**UI:**
- `/volunteer/hours`: a mobile-first form (big inputs) and YTD KPI cards (verified hours and in-kind value, pending hours).
- On the same page, my ledger table with a verification badge, withdraw, and rejected entries with the reason.
- `/admin/hours`: review queue table with approve, reject (reason modal) and "Log hours for a volunteer".

**Dashboard:** add a member KPI for "My volunteer hours (YTD)" from `getMyHoursSummary`, plus a pastel quick link to `/volunteer/shifts`. Keep the existing cards.

### WD: Grant export engine
**Owns:**
- `src/lib/validation/grants.ts`
- `src/lib/dal/grants.ts`
- `src/lib/csv.ts`
- `src/app/(admin)/admin/grants/**`: `page.tsx`, `export/route.ts` and `print/page.tsx`
- `src/components/grants/**`

**Filters** (zod, parsed from URL search params, because the page is a GET form):
- `from` and `to` (YYYY-MM-DD in LA, inclusive; default = Jan 1 of this LA year to today)
- `program`: `"all"` | `"org"` (programId null) | uuid
- `categories`: subset of `VOLUNTEER_CATEGORIES`; empty means all
- `verification`: `"verified"` (`shift_checkin` + `admin_approved`, the default) | `"all"` | one method
- Always exclude soft-deleted rows.
- Date range: `activityDate >= laDateInputToUtc(from, false)` and `<= laDateInputToUtc(to, true)`.

**DAL** (board-only):
- `getGrantReport(ctx, filters)` returns:
  - `{ totals: { entries, volunteers, minutes, valueCents }, byCategory, byProgram, byMonth (LA YYYY-MM), byVolunteer (name, email, minutes, valueCents) }`
  - Value per row = `inKindValueCents(durationMinutes, inKindRateCents ?? currentInKindRateCents())`. Sum in SQL as bigint (`minutes × rate`), then divide by 60 and round once per row, or compute per row in JS. Pick one approach and keep totals exactly equal to the sum of CSV rows.
  - Audit `grant.report_viewed`.
- `listGrantLedgerRows(ctx, filters)`: every row for the CSV.

**CSV** (`src/lib/csv.ts`):
- `toCsv(headers, rows)`: RFC 4180 quoting, CRLF line endings, a UTF-8 BOM, and CSV-injection guard (prefix `'` to cells starting with `= + - @` or tab/CR).
- Columns: Activity date (LA), Volunteer, Email, Program, Category, Hours (2 dp), Rate/hr, In-kind value, Verification, Approved by, Approved at (LA), Description, Entry ID.
- `export/route.ts`:
  - GET with the same search params.
  - Resolve the session with `getSessionContext()`. Route handlers bypass layouts, so return 404 if the user isn't board.
  - `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="gbys-volunteer-hours_<from>_<to>.csv"`.
  - Audit `grant.exported` with the filters and the row count.

**UI:**
- `/admin/grants`: filter form, KPI cards (hours, in-kind value, volunteers, entries), breakdown tables, and "Export CSV" and "Printable summary" links that carry the same params.
- `/admin/grants/print`:
  - A print-optimized summary: org header "Gold Beach Youth Sports (501(c)(3))", date range, filters, the rate statement, totals, breakdown tables, and a generated-at timestamp in LA time.
  - A client "Print / Save as PDF" button calling `window.print()`, hidden in print.
  - This is the "printable PDF summary" (the browser saves it as PDF); there is no PDF library.
  - Audit `grant.exported` with `format: "print"`.

### WE: Compliance cron (`cron-compliance` is already scheduled on Railway)
**Owns:**
- `src/lib/dal/cron-compliance.ts` (system job: no `SessionContext`; the allowed exception to the ctx rule; `import "server-only"`)
- `src/app/api/cron/compliance/route.ts`
- `src/lib/email.ts` (add functions only; keep the existing ones working)

**Route:**
- POST only.
- `Authorization: Bearer ${CRON_SECRET}`, compared with `crypto.timingSafeEqual` on equal-length buffers. A missing `CRON_SECRET` gives 503; a bad token gives 401.
- `export const dynamic = "force-dynamic"`.
- Returns a JSON summary.

**`runComplianceSweep(now = new Date())`:**
1. Expire: `status = 'verified' AND expiresAt < now` becomes `expired`, `RETURNING`. Audit `credential.expired` for each row (actor null).
2. 30-day warning: verified, `now < expiresAt <= now + 30d`, `expiresAt > now + 7d`, and `expiryWarning30SentAt` null. Send with the existing `sendCredentialExpiringEmail` (check its signature), then stamp the row.
3. 7-day warning: verified, `now < expiresAt <= now + 7d`, and `expiryWarning7SentAt` null. Send, then stamp.
4. Stamp only after a successful send, so a failure is retried tomorrow. Skip users with `emailBounced` or `deletedAt`.
5. Lapse alerts:
   - For each credential expired in this run, find the owner's `program_roles` with `head_coach` or `assistant_coach` in active programs whose `requiredCredentialIds` contains that `definitionId`.
   - Email that program's `program_admin` users, or every board member if the program has none.
   - Use the new `sendComplianceLapseAlertEmail({ to, recipientName, coachName, programName, credentialName, expiredAt })`.
6. Write one `cron.compliance_run` audit row with the counts.
7. When `CRON_SECRET` is unset in development, allow nothing: there is no bypass.

Format every date in emails in LA time. Keep the sweep idempotent: re-running the same day sends nothing new.

## 2. Shared rules for every worker

- **Files:** only touch the files you own. Do not edit the schema, migrations, shell, nav, layouts, `audit.ts`, `format.ts`, `permissions.ts`, `grant-rate.ts` or `volunteer-categories.ts`. If a contract is missing, define a local helper in your own files and report the gap.
- **Build and dev isolation:**
  - Use `NEXT_DIST_DIR=.next-<ws>` for any `next dev` or `next build` (the `.next-*` dirs are gitignored).
  - `next dev` rewrites `tsconfig.json`, so afterwards run `git checkout tsconfig.json`.
  - Leave no processes running.
- **Database isolation:**
  - Local Postgres 16 runs on localhost:5432 (user `postgres`, password `postgres`).
  - Create your own database `gbys_<ws>` with `createdb`, then run `DATABASE_URL=... npm run db:migrate:prod && npm run db:seed`.
  - Keep `DATABASE_URL` in your shell only and never write `.env`. Drop your database when you're done.
- **Verification:**
  - Gates: `npx tsc --noEmit` (other workers' in-flight files may error; ignore only those) and `next build`.
  - DAL test scripts against your database (stub `server-only` as Sprint 1 workers did).
  - Playwright with a magic-link dev login where feasible.
  - Keep scripts in the scratchpad, not the repo.
- **Git:** do not commit or push. Report: files, any contract deviations, and verification results, concisely.
