# Phase 1 Plan: UX polish, photos, sidebar behavior, Board of Directors

These contracts bind the parallel workers. Invariants are in `AGENT_HANDOFF.md`, with 3, 4 and 9 the most relevant here. Prior conventions still apply:
- DAL functions take `ctx` first and authorize inside the function.
- Actions follow zod → `runAction` → `revalidatePath` → `ActionResult`.
- Forms use `useActionForm`.
- UI uses only `src/components/ui/*`.
- All times are shown in LA time, with no horizontal overflow at 390px.

Teams and field scheduling come in **Phase 2**. Don't build them now.

## User decisions

- Coaches will see only their own team. This is Phase 2: in Phase 1, keep the current program-wide staff access.
- Board votes come in two kinds:
  - **In-meeting**: quorum is taken from recorded attendance, and the motion passes by the chosen threshold of votes cast.
  - **Action without a meeting**: it passes only if **every** eligible director votes yes.
- The Board module is board-only. Members see the meeting schedule (meetings marked `isPublic`) and minutes that are **approved and marked public**. Drafts, motions and votes stay board-only. Directors can vote on their own motions.

## 0. Done by the orchestrator (read it; don't redo it)

### Schema (migration `0008`)

- `users`: `avatarObjectKey`, `avatarUpdatedAt`.
- `athletes`: `photoObjectKey`, `photoUpdatedAt`.
- Board tables in `src/db/schema/board.ts`:
  - `board_members` (seats and terms). A seat counts as seated when `isVotingDirector`, `termStart <= day <= termEnd` (null `termEnd` = open), and it hasn't ended.
  - `board_meetings`
  - `board_meeting_attendance`, unique on (meeting, seat)
  - `board_minutes`, versioned per meeting. Only approved minutes can be public. **A DB trigger makes approved minutes immutable** except for `is_public`.
  - `board_motions`. In-meeting motions need a meeting. Without-meeting motions must use `unanimous_of_directors`. The eligible seats and the result are snapshotted.
  - `board_votes`, unique on (motion, seat). **A DB trigger makes them fully immutable.**

### Code

- **`src/lib/storage.ts`:** `putPrivateObject`, `getPrivateObject` (returns null when missing), `deletePrivateObject`. These are server-side uploads, so no bucket CORS is needed.
- **`src/lib/image.ts`:**
  - `processPhoto(buffer, size)`: sniffs PNG, JPEG, WEBP or HEIC; caps uploads at 8 MB; auto-rotates; **strips all metadata including GPS**; square-crops and resizes; outputs WEBP. It throws `PhotoError` with a friendly message.
  - `sniffPhotoType`.
  - `sharp` is now a direct dependency.
- **`src/lib/dal/context.ts`:** `avatarUrlFor(user)` is exported, and `SessionContext.image` now prefers an uploaded avatar (`/media/avatar/<id>?v=<ms>`), falling back to the provider image. The shell user menu therefore needs no changes.
- **`src/lib/dal/board-shared.ts`:**
  - `requireBoardModule(ctx)`: board only.
  - `listSeatedDirectors(at?, tx?)`.
  - `getMySeat(ctx, at?, tx?)`.
  - `defaultQuorum(n)`: a majority of the seated seats.
- **`src/lib/audit.ts`:** new actions `photo.*`, `board_member.*`, `board_meeting.*`, `board_attendance.recorded`, `board_minutes.*`, `board_motion.*` and `board_vote.cast`, plus their targets.
- **Nav (done):** "Board meetings" at `/board` (everyone, in Overview) and "Board of Directors" at `/admin/board` (Administration).

## 1. Workstreams (parallel; no file overlap)

### P1: Polish, dashboard and reusable emergency contacts

**Owns:**
- `src/components/household/invite-guardian-modal.tsx`: the label becomes **"Invite parent or guardian"**, used everywhere that button or modal title appears.
- `src/components/household/athlete-form-modal.tsx` and `src/components/household/emergency-contacts-fields.tsx`.
- New `src/lib/dal/emergency-contacts.ts`.
- `src/components/my-roles/role-card.tsx` and `src/app/(portal)/volunteer/roles/page.tsx`: **remove** the "Needs approval" / "Join right away" pills and the "Includes roster access…" callout. Use neutral wording everywhere:
  - The button reads "Sign up" for open roles and "Request to join" when approval is needed.
  - The page description no longer mentions those labels.
  - After a sign-up the result can still say "Request sent" vs "You're in".
- `src/app/(portal)/dashboard/page.tsx`, new `src/lib/dal/dashboard.ts` and `src/components/dashboard/**`.

**Reusable emergency contacts:**
- `listMyEmergencyContacts(ctx)` returns the distinct `{ name, phone, relationship }` entries saved on any athlete where I'm a guardian (dedupe on normalized phone plus name). It is not audited, because it returns only my own household's contact cards and never medical notes.
- In the athlete form, each contact row gets a "Use a saved contact" select that fills the row. You can still type a contact manually.
- Don't change how contacts are stored.

**Dashboard** (`getMemberDashboard(ctx)`). Remove the volunteer-hours KPI and any hours numbers. Show:
- **My household:** athletes with first name, age and photo (if `photoUrl` is present; otherwise initials). Plain names here, never medical data. Link to `/household`.
- **Registered programs:** live registrations for the current and upcoming seasons, showing athlete, program/season, season dates and payment status. Link to `/registrations`.
- **Outstanding dues:** the sum of `feeCents` for live `unpaid` registrations, listed per registration with the "pay your program by cash/check" text. Hide this section when the total is $0.
- **Needs your attention:** at most 4 items, each a whole-row link:
  - missing credentials for my active volunteer roles
  - pending role requests
  - credentials expiring within 30 days
  - unpaid dues
- **My volunteer roles:** role names and status only, with no hours.
- **Quick links:** each `PastelCard` is wrapped in a single `<Link>` so **the whole card is clickable**, with a visible focus ring, hover lift and `aria-label`. Don't nest interactive elements; keep the arrow as decoration. Shift links only appear when `isFeatureEnabled("volunteerShifts")` is on.

### P2: Athlete and profile photos

**Owns:**
- New `src/lib/dal/photos.ts`.
- New `src/app/media/athlete/[id]/route.ts` and `src/app/media/avatar/[userId]/route.ts`.
- New `src/components/photos/**`.
- Edits to:
  - `src/lib/dal/households.ts`: add `photoUrl` to the athlete summary and detail, and the avatar to my profile.
  - `src/components/household/{athlete-table,athlete-detail-sheet,profile-card}.tsx`. Also **remove the "Medical access audited" pill** in `athlete-table.tsx`.
  - `src/app/(portal)/household/**` pages and actions, for photo actions only.
  - `src/lib/dal/rosters.ts` and `src/components/rosters/**`: add a photo thumbnail to the roster and emergency sheet. Photos are cached offline along with the sheet, and the `/media/athlete` route must not break the service-worker rules.
  - `src/lib/dal/users-admin.ts` and `src/components/users/**`: use `avatarUrlFor` for avatars.

**DAL:**
- `uploadAthletePhoto(ctx, athleteId, file)`:
  - Allowed for guardians with `canRegister`, or the board.
  - Processes to 800px with `processPhoto`.
  - Stores the photo under the key `athletes/<athleteId>/<uuid>.webp`, sets `photoObjectKey` and `photoUpdatedAt`, and deletes the previous object (best effort).
  - Audits `photo.updated`.
- `removeAthletePhoto(ctx, athleteId)`.
- `uploadMyAvatar(ctx, file)`: 512px, key `avatars/<userId>/<uuid>.webp`.
- `removeMyAvatar(ctx)`.

**Who can view an athlete photo** (`canViewAthletePhoto(ctx, athleteId)`):
- a guardian of the athlete;
- the board;
- any program staff (`canViewRoster`) of a program where the athlete has a live registration. Phase 2 narrows this to team staff.

**Media routes:**
- **`GET /media/athlete/[id]`:** returns 401 without a session and 404 unless `canViewAthletePhoto` allows it. Headers:
  - `Content-Type: image/webp`
  - `Cache-Control: private, max-age=86400` (URLs carry `?v=`)
  - `X-Content-Type-Options: nosniff`
  - CSP sandbox

  Photo views are not audited (photos aren't medical data), but the route must never leak existence.
- **`GET /media/avatar/[userId]`:** any signed-in user; the same headers apply.

**UI:**
- An "Add photo" or "Change photo" control with a preview, on the athlete detail sheet and on the profile card.
- Accept `image/*` (phones offer the camera).
- Show the client-side size limit.
- Server actions take `FormData`. The orchestrator already set `experimental.serverActions.bodySizeLimit: "10mb"` in `next.config.ts`, so 8 MB photos fit.

### P3: Sidebar behavior

**Owns:**
- `src/components/shell/sidebar.tsx` and `src/components/shell/app-shell.tsx`.
- `src/components/shell/nav-list.tsx`, and any new shell files.
- **Don't** edit `nav.ts`, `nav-icons.ts`, `user-menu.tsx` or `mobile-nav.tsx` (mobile stays as is).

**New desktop behavior** (replaces the collapsed/expanded cookie semantics):
- Cookie `gbys_sidebar` = `pinned` | `unpinned`. Treat the legacy value `expanded` as pinned and `collapsed` as unpinned.
- **Pinned:** always expanded, with the same layout as today's expanded state.
- **Unpinned:**
  - The layout reserves only the 80px rail, so content never shifts.
  - On every full page load the sidebar starts **expanded as an overlay**, then auto-collapses after about 3 seconds. Hovering or focusing inside it cancels the timer.
  - When collapsed, hovering (and `focus-within`, for keyboard users) **expands it as an overlay** over the content, with a shadow. Mouse leave or blur collapses it again after a short delay of about 300ms.
  - Client-side navigations don't re-trigger the auto-collapse, because the layout persists.
- **Controls when expanded:** a **pin** toggle (Pin/PinOff icon, `aria-pressed`, title "Keep sidebar open") next to the existing Collapse button.
  - Collapse → unpinned and collapsed now.
  - Pin → pinned.
- **Server rendering:** a pinned page renders expanded. An unpinned page renders the rail with the overlay open, so the first paint shows the labels, and the client then starts the timer.
- Respect `prefers-reduced-motion` (no width animation) and keep `aria-expanded` accurate.

### B1: Board members, meetings, attendance and minutes

**Owns:**
- New `src/lib/dal/board-members.ts` and `src/lib/dal/board-meetings.ts`.
- `src/lib/validation/board.ts`.
- `src/app/(admin)/admin/board/page.tsx`: an overview with the seated directors, the next meeting, open motions count (read via a simple count query on `board_motions`) and minutes awaiting approval.
- `src/app/(admin)/admin/board/members/**` and `src/app/(admin)/admin/board/meetings/**` (list plus `[id]` detail).
- `src/app/(portal)/board/page.tsx` and `src/app/(portal)/board/meetings/[id]/page.tsx`, for members.
- `src/components/board/**`.

**Members:**
- `listBoardMembers(ctx, { include: "current" | "all" })`.
- `addBoardMember(ctx, { email?, displayName, position, isVotingDirector, termStart, termEnd?, electedOn?, notes? })`. Linking a user by email is optional, but a seat without an account can't vote electronically, so warn about it. Also warn when a linked user's `orgRole` isn't board, with a link to `/admin/users/[id]` to grant access. Nothing changes roles automatically.
- `updateBoardMember`.
- `endBoardMember(ctx, id, { endedAt, reason })`, for resignation or removal. Seats are never hard-deleted.
- Show term timeline badges: Current, Upcoming, Ended, and "Term ends in N days" when 60 days or fewer remain.

**Meetings:**
- `listMeetings(ctx, { range })`, `createMeeting`, `updateMeeting`, `cancelMeeting`.
- `recordAttendance(ctx, meetingId, [{ boardMemberId, status }])` takes the seats seated at the meeting start and writes an upsert per seat.
- `markMeetingHeld`.
- An `.ics` download per meeting (`/admin/board/meetings/[id]/ics` and `/board/meetings/[id]/ics` for public meetings).

**Minutes:**
- `saveMinutesDraft(ctx, meetingId, body)` creates or updates the latest draft. If the latest version is approved, it creates version n+1 as a draft.
- `approveMinutes(ctx, minutesId, { motionId? })` sets `status=approved`, `approvedAt` and `approvedBy`.
- `setMinutesPublic(ctx, minutesId, isPublic)` works only on approved minutes.
- The editor is a Markdown textarea with a preview. Render Markdown **safely**: escape HTML and allow no raw HTML. Use a tiny safe renderer or a well-known library with HTML disabled, and report which.

**Members' `/board`:** upcoming public meetings (date, time, location, link, agenda) and past meetings with their public approved minutes. Never show drafts, motions or votes.

### B2: Motions and electronic voting

**Owns:**
- New `src/lib/dal/board-motions.ts` and `src/lib/validation/board-motions.ts`.
- `src/app/(admin)/admin/board/motions/**` (list plus `[id]`).
- `src/app/(portal)/board/votes/**`: the director's voting page, for **any seated director with a linked account regardless of org role**. Non-directors get a 404.
- `src/components/board-motions/**`.
- `src/lib/email.ts`: add functions only.

**DAL:**
- **Creating and editing:** `createMotion(ctx, { kind, meetingId?, title, body, threshold, movedBy?, secondedBy? })` and `updateMotion` (draft only). Both are board-only.
  - **Without-meeting motions:** the threshold is forced to unanimous.
  - **In-meeting motions:** the meeting must exist and not be cancelled.
- **`openMotion(ctx, id, { closesAt? })`** (board only). Snapshot `eligibleBoardMemberIds = listSeatedDirectors(now)`.
  - **In-meeting:** requires recorded attendance. `quorumRequired = defaultQuorum(seated)`, and the motion refuses to open when present plus remote attendance is below quorum ("No quorum").
  - **Without-meeting:** `closesAt` is required (at least 24 hours out). Email every eligible seat that has an account with a link to `/board/votes/[id]`.
- **`castVote(ctx, motionId, choice)`:**
  - Runs in a transaction that locks the motion `FOR UPDATE`.
  - The motion must be open and not past `closesAt`.
  - The caller's seat (`getMySeat`) must be in the eligible snapshot.
  - Inserts the vote, with `recordedBy` equal to the caller. A unique violation means "already voted"; the votes trigger forbids changes.
- **`recordRollCallVote(ctx, motionId, boardMemberId, choice)`:** board-only, **in-meeting motions only**, for the secretary to record voice votes. The seat must be eligible **and** marked present or remote. It sets `recordedBy` to the secretary and writes an audit row.
- **`closeMotion(ctx, id)`:** board only, or automatic when the motion is viewed after `closesAt` (lazy close). Compute and snapshot `result = { yes, no, abstain, cast, eligible, present?, quorum?, passed, reason }`, and set `passed` or `failed`.
  - `majority_of_votes_cast`: yes > (yes + no) / 2. Abstentions don't count as cast.
  - `two_thirds_of_votes_cast`: yes ≥ ⅔ × (yes + no).
  - `unanimous_of_directors`: **every eligible seat voted yes.** Any no, abstain or missing vote at close means it fails.
  - Without-meeting motions **close early** as failed when any eligible seat votes no or abstain, and as passed the moment every eligible seat has voted yes.
  - For in-meeting motions, quorum is checked again at close.
- **`withdrawMotion`:** only draft or open motions with no votes cast.
- **`getMotion` and `listMotions`:** board only. The director votes page lists only the motions where I'm eligible.

**UI:**
- **Motions list:** filters by status and kind.
- **Motion detail:** the text, kind and threshold explained in plain words, the eligible directors, a live tally, the vote list with time and who recorded each vote, and open/close/withdraw controls.
- **In-meeting roll-call recorder:** a grid of present seats with Yes/No/Abstain.
- **`/board/votes`:** my open motions, each with "Vote Yes / No / Abstain". The confirm step says "Your vote is final and recorded."

Every action writes an audit row.

## 2. Shared rules

- **Ownership:**
  - Touch only the files you own.
  - Never edit the schema, migrations, `context.ts`, `permissions.ts`, `audit.ts`, `board-shared.ts`, `image.ts`, `storage.ts`, `nav.ts`, `nav-icons.ts` or `next.config.ts`. Report anything you need changed there.
- **Dev isolation:** use `NEXT_DIST_DIR=.next-<ws>`, run `git checkout tsconfig.json` afterwards, and leave no processes running.
- **Database:**
  - Each worker uses its own DB `gbys_<ws>` on localhost:5432 (user `postgres`, password `postgres`). Start the cluster with `pg_ctlcluster 16 main start` if it's down.
  - Set up with `DATABASE_URL=... npm run db:migrate:prod && npm run db:seed`, and use SQL fixtures with real `gen_random_uuid()` ids.
  - Never write `.env`. Drop your DB when you're done.
- **Photos without real S3:** run a tiny local S3-compatible stub. Earlier workers used a fake S3 server in a scratchpad script. Set the S3 env vars to point at it, in the shell only.
- **Verification:**
  - `npx tsc --noEmit` and `next build`.
  - A DAL test script, including races where relevant: concurrent `castVote` for the same seat gives one row; concurrent opens give one snapshot.
  - Playwright with the magic-link dev login. Space sign-ins out.
  - Check 390px widths.
  - Put scripts in the scratchpad.
- **Git:** don't commit or push. Report files, deviations and verification, concisely.
