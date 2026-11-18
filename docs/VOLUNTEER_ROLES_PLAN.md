# Volunteer Roles Plan (roles replace shift scheduling for now)

These contracts bind the parallel workers. Invariants are in `AGENT_HANDOFF.md`: 2, 4, 7 and 9 matter most. Earlier conventions still apply:
- DAL functions take `ctx` first and authorize inside.
- Actions follow zod → `runAction` → `revalidatePath` → `ActionResult`.
- Forms use `useActionForm`.
- UI comes only from `src/components/ui/*`.
- Times are in LA, and pages must not overflow horizontally at 390px.

## Product decisions (from the user)

- **Volunteer roles** are positions such as "Program Coordinator", "Head Baseball Coach" or "Concessions Lead". A role belongs to a **program** or is **org-wide** (`programId` null).
- Each role has **expected hours per term**, so grant reports can show expected against logged hours. The period is set per role:
  - `per_season`: program roles only. The term is one season of that program.
  - `per_year`: the term is an LA calendar year.
- **Approval is set per role** with `requiresApproval`.
  - Open roles become `active` immediately on sign-up.
  - Approval-required roles start `pending` until a manager approves them.
- **Optional permission link.** A role can grant a permission role (`grantsProgramRole`, e.g. `head_coach`) when approved.
  - **Safety, enforced by the DB constraint `volunteer_roles_grant_safety_chk`:** a granting role must be program-scoped *and* require approval, so nobody can give themselves access to rosters or medical data. Also validate this in zod and the DAL, with a friendly message.
- **Shift scheduling is hidden everywhere behind a feature flag.** `isFeatureEnabled("volunteerShifts")` reads `FEATURE_VOLUNTEER_SHIFTS=true` and defaults to off. The code and tables stay.

## 0. Done by the orchestrator (read it, don't redo it)

### Schema: migration `0007` in `src/db/schema/volunteers.ts`

**`volunteer_roles`:**
- Columns:
  - `programId`, `name`, `description`
  - `category` (default category for hours logged against the role)
  - `period`, `expectedMinutes` (per term, 0–200000)
  - `slots` (live assignments per term; null means unlimited)
  - `requiresApproval`, `grantsProgramRole`
  - `requiredCredentialIds` (shown at approval and on the sign-up page)
  - `isActive`, `createdByUserId`, timestamps
- Check constraints:
  - A `per_season` role must have a program.
  - A granting role must be program-scoped and require approval.

**`volunteer_role_assignments`:**
- Columns:
  - `roleId`, `userId`
  - Either `seasonId` or `year` (enforced by a check constraint), plus `termKey`
  - `status`: `pending`, `active`, `declined`, `withdrawn` or `ended`
  - `expectedMinutes`, a snapshot taken when the assignment becomes active
  - `signupNote`
  - `decidedAt`, `decidedByUserId`, `decisionNote`
  - `endedAt`, `endedByUserId`, `endReason`
  - `programRoleId`
- A partial unique index allows only one live (`pending` or `active`) row per role, user and term.
- **Rows are never deleted.** Re-signing up after a decline or withdrawal inserts a new row.

**`volunteer_logs.volunteerRoleAssignmentId`:** new, nullable, indexed. It links logged hours to a role assignment.

### Shared helpers

**`src/lib/dal/volunteer-role-shared.ts`** (use these; don't reimplement them):
- `canManageVolunteerRole(ctx, programId | null)`: `canManageProgram` for program roles, board for org-wide roles.
- `termKeyForSeason(id)` and `termKeyForYear(y)`.
- `getTermBounds({ seasonId, year }, tx?)` returns `{ start, end, label }`.
  - A season maps to `startsOn..endsOn`; if the season has no dates, the bounds are null.
  - A year maps to the LA calendar year.
- `getAssignmentProgress(ids, tx?)` returns a `Map` of `{ verifiedMinutes, pendingMinutes }`.
  - Verified means not `self_reported`. Soft-deleted rows are excluded.
- `grantLinkedProgramRole(tx, assignment, role)` creates the `program_roles` row.
  - The row is season-scoped for `per_season` roles.
  - If an identical grant already exists, it creates nothing and returns null.
- `revokeLinkedProgramRole(tx, assignment)` deletes the linked `program_roles` row.

**`src/lib/volunteer-roles.ts`** (client-safe): period and status labels, `formatExpectation(minutes, period)` and `fulfilmentPercent(logged, expected)`.

**`src/lib/features.ts`:** `isFeatureEnabled("volunteerShifts")`. It is server-side only.

**`src/lib/audit.ts`:**
- Actions: `volunteer_role.created`, `updated`, `archived`, `restored`, `signed_up`, `approved`, `declined`, `withdrawn` and `ended`.
- Targets: `volunteer_role` and `volunteer_role_assignment`.

## 1. Workstreams (parallel, with no file overlap)

### WR1: Role catalog and approvals (program staff and board)

**Owns:**
- `src/lib/validation/volunteer-roles.ts`
- `src/lib/dal/volunteer-roles.ts`
- `src/app/(portal)/programs/[slug]/roles/**` (`page.tsx`, `actions.ts`)
- `src/app/(admin)/admin/volunteer-roles/**` (`page.tsx`, `actions.ts`)
- `src/components/volunteer-roles/**`
- An edit to `src/app/(portal)/programs/[slug]/page.tsx`: add a "Volunteer roles" card or link showing the count of active roles and pending sign-ups.

**DAL** (every function authorizes with `canManageVolunteerRole` inside it):
- `listManagedRoles(ctx, scope: { programId } | { orgWide: true } | { all: true })`:
  - `all` is board-only.
  - Each role carries counts of live assignments for the current term(s) and its pending count.
- `createRole(ctx, input)` and `updateRole(ctx, id, input)`:
  - Input fields: name (2–80), description, category, period, expected hours (decimal hours → minutes; 0–2000), slots (blank = unlimited), `requiresApproval`, `grantsProgramRole` (program roles only; when set, `requiresApproval` is forced true), and `requiredCredentialIds` (active credential types only).
  - Once live assignments exist, `period`, `programId` and `grantsProgramRole` can't change.
  - An expected-hours change applies to *new* activations only, because existing ones keep their snapshot. Tell the user this in the UI.
  - Audit both create and update.
- `archiveRole` and `restoreRole`:
  - An archived role takes no new sign-ups.
  - Existing assignments are left alone; the user can end them separately.
  - Audit both.
- `listAssignmentsForReview(ctx, { scope, status?, termKey? })` returns, per row:
  - The volunteer's name and email, the role, and the term label.
  - Status, `signupNote` and the decision fields.
  - Expected minutes (the snapshot, or the role's current value while pending).
  - Progress, from `getAssignmentProgress`.
  - **Credential readiness:** for each of the role's `requiredCredentialIds`, whether the user has a verified, unexpired credential.
- `approveAssignment(ctx, id, note?)`:
  - Runs in a transaction. Lock the assignment and the role `FOR UPDATE`.
  - The assignment must be pending.
  - Re-check slots: count *active* assignments for the role and term, which must be fewer than `slots`.
  - Set `status=active`, `expectedMinutes` (snapshot), `decidedAt` and `decidedBy`.
  - Set `programRoleId` to the result of `grantLinkedProgramRole`.
  - Audit `volunteer_role.approved`.
  - If credentials are missing, still allow it, but the UI shows a warning and asks for confirmation.
  - Managers can't approve their own sign-up for a granting role (no self-granting permissions). For non-granting roles they can.
- `declineAssignment(ctx, id, reason)`: reason is required; audit it.
- `endAssignment(ctx, id, reason)`:
  - Only an active assignment; reason is required.
  - Sets `ended`, calls `revokeLinkedProgramRole`, and writes an audit row.
  - Logged hours stay attached to the assignment.
- `assignVolunteer(ctx, { roleId, email, seasonId? | year?, note? })`:
  - A manager directly assigns a user, who must already exist.
  - The assignment is created `active`, with the snapshot taken and the permission granted.
  - Reject it if the slots are full or the user already has a live assignment.
  - Audit `volunteer_role.approved` with metadata `{ direct: true }`.
  - No self-assignment to granting roles.

**UI:**
- **`/programs/[slug]/roles`** (program staff can view; managers can edit):
  - A roles table showing period, expected hours, slots used against the total, approval mode, and any permission granted (as a badge).
  - Create and edit modals with a credential picker.
  - Archive and restore.
  - A **Sign-ups** section with pending first: approve, decline (reason modal), end, and a credential readiness checklist. Includes progress bars for expected against logged hours.
  - An "Assign volunteer" modal.
- **`/admin/volunteer-roles`** (board):
  - Two tabs: **Org-wide roles** (full CRUD and approvals, same components) and **All programs**, a read-only overview of every program's roles and assignments linking to each program's roles page.
  - Includes a pending-approvals queue across all programs.

### WR2: Volunteer sign-up, my roles and hours integration

**Owns:**
- `src/lib/validation/volunteer-role-signups.ts`
- `src/lib/dal/volunteer-role-signups.ts`
- `src/app/(portal)/volunteer/roles/**` (`page.tsx`, `actions.ts`)
- `src/components/my-roles/**`
- Edits to:
  - `src/lib/dal/volunteer-hours.ts` (keep the `laYearBounds` and `laYearOf` exports, which the shared helper imports)
  - `src/lib/validation/hours.ts`
  - `src/components/hours/**`
  - `src/app/(portal)/volunteer/hours/**`
  - `src/app/(admin)/admin/hours/**` (the log-on-behalf modal only)
  - `src/app/(portal)/dashboard/page.tsx`

**DAL:**
- `listOpenRoles(ctx, { programId? })`:
  - Active roles of active programs, plus org-wide roles.
  - For each role: description, expectation text, required credentials (with *my* readiness), approval mode, and whether it grants staff access (say "includes roster access" in plain words), plus its **available terms**:
    - `per_season`: seasons of the program that are active and not ended (`endsOn` is null or today or later, in LA time), ordered by start.
    - `per_year`: the current LA year, plus the next year from October 1 onward.
  - For each term: slots left (null means unlimited) and my live assignment status, if any.
- `signUpForRole(ctx, { roleId, seasonId? | year?, note? })`:
  - In one transaction, lock the role row `FOR UPDATE`. The role must be active and its program active.
  - The term must be one of the role's available terms.
  - Slots: live (`pending` + `active`) assignments for the term must be fewer than `slots`.
  - Insert the assignment as `pending`, or as `active` if `!requiresApproval`. An active assignment snapshots `expectedMinutes` and grants nothing; the DB guarantees open roles don't grant.
  - Audit `volunteer_role.signed_up`. Map a unique violation to "already signed up".
- `withdrawMyAssignment(ctx, assignmentId)`:
  - Only my own pending or active assignment.
  - Sets `withdrawn`, calls `revokeLinkedProgramRole`, and audits it.
- `listMyAssignments(ctx)`:
  - Active and pending first, then history.
  - Each row: role, program (or "Org-wide"), term label, status, expected (snapshot or role value), and progress from `getAssignmentProgress`.

**Hours integration:**
- `logMyHours` and `logHoursForVolunteer` accept an optional `volunteerRoleAssignmentId`. When it is set:
  - The assignment must belong to the volunteer and be active.
  - The activity date must fall within `getTermBounds`, when the bounds are known.
  - The `programId` is forced to the role's program (null for org-wide roles).
  - The category defaults to the role's category but can be changed.
  - Store the id on the ledger row.
- The hours form gets a "Volunteer role (optional)" select of my active assignments. Choosing one pre-fills the program and category.
- The ledger table shows the role, and `listMyHours` returns the role name.

**UI:**
- **`/volunteer/roles`** has two parts:
  - **My roles:** cards with a progress bar of expected against logged hours (verified, with pending shown separately), the status badge, and withdraw.
  - **Find a role:** a filter by program; role cards with the term select, sign-up note and "Sign up" or "Request to join"; required credentials with ✓/✗ for me; and a link to `/volunteer/credentials` when something is missing.
- **Dashboard:**
  - Replace the "Sign up for a volunteer shift" quick link with "Find a volunteer role" (`/volunteer/roles`).
  - Add a "My volunteer roles" summary showing active roles and hours logged against expected.
  - Only show the shift link when `isFeatureEnabled("volunteerShifts")`.

### WR3: Feature flag, navigation, grant reporting and admin overview

**Owns:**
- `src/components/shell/nav.ts` and `src/components/shell/nav-icons.ts`
- The shift pages and actions:
  - `src/app/(portal)/volunteer/shifts/page.tsx`, `actions.ts`
  - `manage/page.tsx`, `manage/actions.ts`
  - `[id]/page.tsx`
- `src/lib/dal/admin-overview.ts`
- `src/components/admin/**`
- `src/app/(admin)/admin/page.tsx`
- `src/lib/dal/grants.ts`
- `src/lib/validation/grants.ts`
- `src/components/grants/**`
- `src/app/(admin)/admin/grants/**`, including `export/route.ts` and `print/page.tsx`

**Feature flag:**
- `getNavGroups` takes `{ volunteerShifts: boolean }`, passed in from `AppShell`'s caller. Alternatively, `nav.ts` can stay pure and the shell calls `isFeatureEnabled`. If `app-shell.tsx` needs a one-line change, make it and report it.
- When the flag is off:
  - Hide "Shifts" and "Manage shifts".
  - Every shift page returns `notFound()`.
  - Every shift action returns `{ ok: false, error: "Shift scheduling is turned off." }`.
- Add "Roles" (`/volunteer/roles`) to the Volunteer group, between Credentials and Hours, and "Volunteer roles" (`/admin/volunteer-roles`) to the Administration group after Users. Pick suitable lucide icons.

**Admin overview:**
- When the flag is off, replace the "Upcoming shifts" card with a "Volunteer roles" card:
  - Active assignments.
  - Pending approvals, linking to `/admin/volunteer-roles`.
  - Expected against verified hours for the current year's terms.
- Add a "Volunteer role sign-ups pending approval" attention item.

**Grant engine:**
- `getGrantReport` gains `byRole`: role name, program, entries, minutes and value.
  - Ledger rows without an assignment are grouped as "No role".
  - Add a `role` filter: `"all"`, `"none"` or a role id.
  - The totals invariant still holds: totals = the sum of the rows.
- The CSV gets a "Volunteer role" column.
- **New "Role commitments" section** on `/admin/grants` and the print page, driven by the same date range:
  - The terms are the assignments whose term overlaps the range. A year term overlaps when its year intersects the range. A season term overlaps on its `startsOn`/`endsOn`; a season with no dates counts by the season's `createdAt` year.
  - Statuses counted: active and ended.
  - Per role: assignments, expected hours (sum of snapshots), verified logged hours for those assignments (all-time against that assignment, not just the date range), fulfilment %, projected in-kind value (expected × current rate from `getInKindRateCents`), and actual in-kind value (from the rows' rate snapshots).
  - This answers "what match did we commit, and what was delivered". Explain the difference between projected and actual in one sentence in the UI.

## 2. Shared rules

- **Ownership:**
  - Touch only the files you own.
  - Never edit the schema, migrations, `audit.ts`, `permissions.ts`, `context.ts`, `volunteer-role-shared.ts`, `volunteer-roles.ts` or `features.ts`. Report anything missing.
  - WR3 may make the one-line `app-shell.tsx` change described above.
- **Dev isolation:**
  - Use `NEXT_DIST_DIR=.next-<ws>` for `next dev` or `next build`.
  - Run `git checkout tsconfig.json` afterwards.
  - Leave no processes running.
- **Database:**
  - Use your own database, `gbys_<ws>`, on localhost:5432 (user `postgres`, password `postgres`; run `pg_ctlcluster 16 main start` if it's down).
  - Set up with `DATABASE_URL=... npm run db:migrate:prod && npm run db:seed`.
  - Insert fixtures with SQL.
  - Never write `.env`. Drop the database when you're done.
- **Verification:**
  - Run `npx tsc --noEmit` and `next build`.
  - Run a DAL test script, including races: two concurrent sign-ups for the last slot must give exactly one winner, and two concurrent approvals for the last slot must give exactly one.
  - Run Playwright with magic-link dev login, spacing out sign-ins.
  - Check 390px for overflow.
  - Keep scripts in the scratchpad.
- **Git:** don't commit or push. Report files, deviations and verification, concisely.
