# Sprint 3a Implementation Plan (Seasons, Registration, Waivers, Offline Payments, Emergency Sheet)

These contracts bind the parallel workers. Invariants are in `AGENT_HANDOFF.md`; 1, 3, 4, 5, 6 and 9 matter most here. The Sprint 1 and 2 conventions in `docs/SPRINT1_PLAN.md` and `docs/SPRINT2_PLAN.md` still apply:
- The DAL takes `ctx` first and checks authorization itself.
- Actions follow zod → `runAction` → `revalidatePath` → `ActionResult`.
- Forms use the `useActionForm` pattern (`src/components/household/use-action-form.ts`).
- UI is built only from `src/components/ui/*`, in the mockup style.
- All dates are in America/Los_Angeles.

Stripe Connect, online checkout, refunds and facilities are **Sprint 3b. Do not build them.** In 3a a registration with a fee is created `unpaid`, and the family pays the program by cash or check. Staff then record the payment.

## 0. Done by the orchestrator (read it, don't redo it)

### Decisions
- **No `organizations` table yet.** It's a single-org deployment, and invariant 1 is met because everything is scoped Program → Season → Registration. Partner-league finances are isolated per program (`programs.stripeAccountId`, Sprint 3b).
- **Placeholders live in code, never in the database.** The draft waiver (`src/lib/waiver-template.ts`) and the sample field sets (`CUSTOM_FORM_TEMPLATES` in `src/lib/custom-form.ts`) only pre-fill editors. Nothing is seeded.

### Schema (migrations `0004` and `0005`)
- **`waiver_versions`** is immutable: insert only, never update or delete. Its columns are `programId` (null for org-wide), `title`, `version`, `body`, `bodyHash`, `createdByUserId` and `createdAt`.
- **`seasons`:**
  - Removed: `waiverText` and `waiverVersion`.
  - Added: `description`, `startsOn`/`endsOn` (date strings), `eligibleBirthDateFrom`/`eligibleBirthDateTo` (inclusive date strings, null meaning unbounded), `waiverVersionId` and `updatedAt`.
  - Check constraint: fee ≥ 0.
- **`registrations`:**
  - `paymentMethod` is now an enum: `stripe`, `cash`, `check` or `scholarship`.
  - Added: `amountPaidCents`, `paidAt`, `paymentRecordedByUserId`, `updatedAt`, `deletedByUserId` and `cancellationReason`.
  - A partial unique index allows one live registration per (season, athlete).
  - `feeCents` is a snapshot of the season fee.
- **`signed_waivers`** is immutable. It gains `waiverVersionId` (NOT NULL) and `signatureName` (the typed legal name). It also keeps `waiverVersion` and `waiverTextHash`, plus the IP address and user agent.
- No Drizzle `relations()` exist for these tables. Use core selects with joins.

### Shared libraries
- **`src/lib/waiver.ts`** (server only): `normalizeWaiverBody(body)` and `hashWaiverBody(body)`, a sha256 hex of the normalized body. Always hash with this function.
- **`src/lib/waiver-template.ts`** (client-safe): `WAIVER_TEMPLATE_TITLE` and `WAIVER_TEMPLATE_BODY`. The body starts with "DRAFT TEMPLATE — REVIEW WITH COUNSEL".
- **`src/lib/custom-form.ts`** (client-safe):
  - `CUSTOM_FIELD_TYPES` and `CUSTOM_FIELD_TYPE_LABELS`.
  - `customFormFieldSchema` and `customFormSchemaSchema` validate a form definition: at most 25 fields, unique lowercase snake_case keys, and at least 2 options for a select.
  - `buildAnswersSchema(fields)` produces the zod schema for registration answers.
  - `CUSTOM_FORM_TEMPLATES`: Cal Ripken and Youth Wrestling.
- **`src/lib/pwa.ts`** (client-safe): `EMERGENCY_CACHE = "gbys-emergency-v1"`, `SW_CLEAR_MESSAGE` and `clearSensitiveCaches()`. Sign-out in the user menu already calls `clearSensitiveCaches()`.
- **`src/lib/dal/permissions.ts`** additions:
  - `PROGRAM_STAFF_ROLES`
  - `canManageProgram(ctx, programId)`: board or `program_admin`.
  - `canViewRoster(ctx, programId)`: board or any staff role (`program_admin`, `head_coach`, `assistant_coach` or `team_manager`).
  - `staffProgramIds(ctx)` and `isProgramStaff(ctx)`.
- **`src/lib/audit.ts`** new actions: `season.created`, `season.updated`, `waiver.version_created`, `waiver.signed`, `registration.created`, `registration.withdrawn`, `registration.cancelled`, `payment.recorded`, `payment.voided` and `roster.viewed`. New targets: `season`, `waiver_version`, `signed_waiver` and `registration`. For emergency-sheet reads, use the existing `medical.viewed`.

### Nav and middleware (done; don't edit)
- Members now get **Registrations** (`/registrations`).
- Board and program staff get **My programs** (`/programs`).
- The middleware protects `/registrations/*` and `/programs/*`.
- `/register/*` stays public: the page itself asks the user to sign in before submitting.

## 1. Workstreams (parallel, no file overlap)

### WF: Program hub, seasons and waiver versions
**Owns:**
- `src/lib/validation/seasons.ts`
- `src/lib/dal/seasons.ts`
- `src/app/(portal)/programs/page.tsx`
- `src/app/(portal)/programs/[slug]/page.tsx`
- `src/app/(portal)/programs/[slug]/actions.ts`
- `src/app/(portal)/programs/[slug]/seasons/new/page.tsx`
- `src/app/(portal)/programs/[slug]/seasons/[seasonId]/page.tsx`
- `src/app/(portal)/programs/[slug]/seasons/[seasonId]/actions.ts`
- `src/components/seasons/**`

**DAL:**
- **`listMyStaffPrograms(ctx)`:** programs where `canViewRoster` holds (board sees all active programs). Each row includes `canManage`, and counts of open seasons and live registrations.
- **`getProgramHub(ctx, slug)`:**
  - Requires `canViewRoster`.
  - Returns the program and its seasons, each with: status (draft / scheduled / open / closed / inactive, computed in LA time), fee, registration window, live registration count, unpaid count and waiver title + version.
- **`createSeason(ctx, programId, input)` and `updateSeason(ctx, seasonId, input)`:**
  - Require `canManageProgram`.
  - Fields:
    - name and description
    - `startsOn` and `endsOn`
    - registration opens/closes as datetime-local values in LA time, converted with `laDateTimeInputToUtc`
    - the eligibility DOB range
    - the fee, entered in dollars and stored as cents
    - `customFormSchema`, validated with `customFormSchemaSchema`
    - `waiverVersionId`, which must belong to this program or be org-wide
    - `isActive`
  - Rules:
    - Closing must come after opening.
    - Before a season can have an opening date set, it must have a waiver.
    - Once a season has live registrations, block removing or renaming field keys and changing the fee. Adding optional fields is still allowed. Changing the waiver is allowed: new signers sign the new version.
  - Audit `season.created` / `season.updated` with the changed field names.
- **`listWaiverVersions(ctx, programId)`:** returns this program's versions plus org-wide ones, newest first.
- **`createWaiverVersion(ctx, { programId | null, title, version, body })`:**
  - An org-wide waiver (`programId` null) can only be created by the board.
  - Store `bodyHash = hashWaiverBody(body)`.
  - Refuse a duplicate (`programId`, `title`, `version`).
  - Refuse a body that still contains "DRAFT TEMPLATE", with the error "Edit the template before saving".
  - Audit `waiver.version_created`.
  - Never update an existing row.
- **`previewSeasonForm(ctx, seasonId)`:** lets staff render the form exactly as families will see it.

**UI:**
- `/programs`: cards for each of my programs.
- `/programs/[slug]`:
  - The seasons table with status badges.
  - Staff links to each season's Registrations and Emergency sheet pages. Those pages are built by WH; link to `/programs/[slug]/seasons/[id]/registrations` and `/programs/[slug]/seasons/[id]/emergency`.
  - A "New season" button for managers.
- Season editor:
  - A details section.
  - A **form builder**: add, remove and reorder fields; edit label, type, required, options and placeholder; a "Start from template" menu; a live preview.
  - A waiver picker, plus a "New waiver version" modal pre-filled from the template.
  - Read-only for non-managers.

### WG: Public registration, waiver e-signature and my registrations
**Owns:**
- `src/lib/validation/registration.ts`
- `src/lib/dal/registrations.ts`
- `src/app/(public)/page.tsx` (edit the landing page: add an "Open registrations" section)
- `src/app/(public)/register/[slug]/page.tsx`, plus `actions.ts` and a client form
- `src/app/(portal)/registrations/page.tsx` and `actions.ts`
- `src/components/registration/**`

**DAL:**
- **`listOpenSeasons(ctx: SessionContext | null)`:**
  - Public and non-sensitive: program name, slug and sport; season name, description, dates, fee, closing date and eligibility.
  - Open means active, now ≥ opens, now < closes (or closes is null), and a waiver is set.
  - Takes a nullable ctx because the landing page is public.
- **`getRegistrationPage(ctx | null, slug)`:**
  - The program's open seasons, each with its form fields and waiver (title, version, body).
  - When signed in, add my household athletes for each season, with eligibility evaluated (age band, already registered, my `canRegister` and `canSignWaivers`).
- **`submitRegistration(ctx, input)`:**
  - Input: `seasonId`, `athleteId`, `answers`, `waiverVersionId`, `signatureName` and `agree: true`.
  - Inside one transaction:
    1. Lock the season row with `FOR UPDATE`.
    2. Re-check that the season is open and that `waiverVersionId` equals the season's current waiver. If it doesn't, tell the user "The waiver was updated — please review it" and refuse.
    3. Check I am a guardian of the athlete with `canRegister` and `canSignWaivers`.
    4. Check DOB eligibility.
    5. Validate the answers with `buildAnswersSchema(season.customFormSchema)`.
    6. Require `signatureName` to be at least 2 words and at most 120 characters.
    7. Insert the registration: `feeCents` snapshot, `paymentStatus` `unpaid` (or `paid` with `amountPaidCents` 0 when the fee is 0), `registeredByUserId`.
    8. Insert `signed_waivers`. Recompute `hashWaiverBody(version.body)` and compare it with the stored `bodyHash`; refuse on mismatch, because that means tampering. Record the IP (first `x-forwarded-for` entry, falling back to `x-real-ip`) and the user agent, from `headers()` in the action passed into the DAL.
    9. Audit `registration.created` and `waiver.signed`.
  - Map a unique violation to "already registered".
- **`listMyRegistrations(ctx)`:**
  - Registrations for athletes I'm a guardian of: program, season, athlete, status, fee and payment status, the waiver version signed, signer and time.
  - Include cancelled registrations with their reason.
- **`withdrawRegistration(ctx, registrationId)`:**
  - Only a guardian with `canRegister`, only while `unpaid`, and only before `season.startsOn`.
  - Soft-delete with reason "Withdrawn by guardian".
  - Audit `registration.withdrawn`.
- **`getSignedWaiver(ctx, registrationId)`:**
  - A guardian of the athlete, or `canViewRoster` for the program, can see the exact signed text: the version body, the hash, and that it matches.

**UI:**
- The landing page gets an "Open registrations" section with season cards linking to `/register/[slug]`.
- `/register/[slug]`: a public program and season summary. When signed out, show "Sign in to register" linking to `/sign-in?next=/register/<slug>`. When signed in, a stepper:
  1. Choose the season and athlete. Ineligible athletes appear disabled with the reason, plus a link to `/household` to add an athlete.
  2. The program's questions, from `customFormSchema`.
  3. The waiver: a scrollable full text, the version shown, an "I agree" checkbox, and the typed legal name.
  4. Confirmation: the fee and payment instructions ("Pay your program by cash or check; a coordinator will record it. Online payment is coming soon."), and a link to `/registrations`.
- `/registrations`: a list with status badges, withdraw, and a "View signed waiver" sheet.

### WH: Rosters, offline payments, emergency sheet and PWA
**Owns:**
- `src/lib/validation/rosters.ts`
- `src/lib/dal/rosters.ts`
- `src/app/(portal)/programs/[slug]/seasons/[seasonId]/registrations/**`
- `src/app/(portal)/programs/[slug]/seasons/[seasonId]/emergency/**`
- `src/components/rosters/**`
- `src/components/pwa/**`
- `public/sw.js`
- `public/icons/*`
- `src/app/manifest.ts`

**DAL:**
- **`listSeasonRegistrations(ctx, seasonId, filter?)`:**
  - Requires `canViewRoster`.
  - Rows: athlete name and age, guardian name, email and phone, the custom answers rendered with field labels, payment status, method and reference, and waiver signed (version and time).
  - **No medical notes in this list.**
  - Audit `roster.viewed`, once per call.
- **`recordOfflinePayment(ctx, registrationId, { method: "cash" | "check" | "scholarship", amountCents, reference })`:**
  - Requires `canManageProgram`.
  - The row must be `unpaid` and live; lock it `FOR UPDATE`.
  - Cash and check require an amount greater than 0 and at most the fee. A reference (check number) is required for check.
  - A scholarship sets `waived_scholarship` with amount 0 and requires a note.
  - Set `paidAt`, `paymentRecordedByUserId` and `offlineReferenceNote`.
  - Audit `payment.recorded`.
  - A partial payment is out of scope: the amount must equal the fee, or use scholarship for a waiver. A lower amount is refused with a clear error.
- **`voidOfflinePayment(ctx, registrationId, reason)`:**
  - Board only; reason required.
  - Back to `unpaid`, clearing the payment fields. The previous values go into the audit metadata.
  - Audit `payment.voided`.
  - Never touch Stripe-paid rows.
- **`cancelRegistration(ctx, registrationId, reason)`:**
  - Requires `canManageProgram`.
  - Soft-delete, recording `deletedBy` and the reason.
  - Audit `registration.cancelled`.
  - If the registration was paid, the error or warning reads "Record a refund outside the app (Sprint 3b adds Stripe refunds)". Still allow it, and note in the metadata that it was paid.
- **`getEmergencySheet(ctx, seasonId)`:**
  - Requires `canViewRoster`.
  - Returns live registrations with the athlete's name, DOB and age, medical notes, emergency contacts, guardian names and phones (from `household_guardians` → `users`, `receivesComms` first), plus program staff names and phones.
  - Write **one** `medical.viewed` audit row with `{ seasonId, athleteCount }`.
  - The response is for coaches. Exclude soft-deleted athletes.

**UI:**
- **Registrations page:**
  - A table with filters (all / unpaid / paid / cancelled) and a KPI row: registered, paid, unpaid, and collected amount via `formatCents`.
  - Managers get "Record payment" (modal) and "Cancel" (reason modal). Board also gets "Void payment".
- **Emergency page:**
  - Large, high-contrast, phone-first cards: name, age, a medical alert badge, notes, and tap-to-call `tel:` links for contacts and guardians.
  - A "Saved for offline" indicator showing the timestamp of the last cached copy, and a "Print" button.
  - The page sends `Cache-Control: private, no-store`. Offline access comes only from the service worker cache.

**PWA:**
- **`src/app/manifest.ts`:** name "Gold Beach Youth Sports", `short_name` "GBYS", theme `#1C1C1E`, background `#F4F3EF`, icons in `public/icons` (generate simple PNGs: a charcoal rounded square with a periwinkle plus, matching the logo; 192 and 512 px, plus maskable).
- **`public/sw.js`** (hand-written, no Serwist):
  - Navigations to `/programs/<slug>/seasons/<id>/emergency` are **network-first**: on success, store in `EMERGENCY_CACHE`; offline, serve the cached copy. Only cache 200 responses that are not redirects.
  - `/_next/static/*` is cache-first in a separate `gbys-static-v1` cache.
  - Every other request is passed through untouched. **Never cache other HTML or any API or auth responses.**
  - On a `SW_CLEAR_MESSAGE` message, delete `EMERGENCY_CACHE`.
  - On activate, delete old cache versions.
  - Cached emergency entries expire after 14 days: check the date header and delete stale entries.
- **`src/components/pwa/register-sw.tsx`:** a client component rendered only on the emergency page. It registers `/sw.js` with scope `/` and shows online/offline status. It has to work without a reload where the browser allows.
- Make sure `next build` serves `public/sw.js` with no caching problems. If needed, add headers for `/sw.js` (`Cache-Control: no-cache`, `Service-Worker-Allowed: /`) via a route or `next.config.ts`. `next.config.ts` is owned by the orchestrator: report it if you need a change rather than editing it.

## 2. Shared rules (same as Sprint 2)

- **Ownership:** touch only the files you own. Don't edit the schema, migrations, shell, nav, layouts, middleware, `next.config.ts` or the shared libraries listed in section 0. If a contract is missing, define a local helper in your own files and report the gap.
- **Build isolation:** use `NEXT_DIST_DIR=.next-<ws>` for every `next dev` or `next build`. Run `git checkout tsconfig.json` afterwards. Leave no processes running.
- **Database isolation:** create your own database `gbys_<ws>` on localhost:5432 (user and password both `postgres`). Run `DATABASE_URL=... npm run db:migrate:prod && npm run db:seed`. Keep env vars shell-only and never write `.env`. Drop your database when you're done. Insert programs, seasons, waiver versions, athletes and guardians directly in SQL when you need fixtures.
- **Verification gates:**
  - `npx tsc --noEmit` and `next build`.
  - A DAL test script, stubbing `server-only` and `React.cache` as earlier workers did.
  - A Playwright pass using the magic-link dev login. In dev the link is logged as `[DEV MAGIC LINK]`. Space out sign-ins, because Better Auth rate-limits them.
  - Check 390 px mobile width with no horizontal page overflow.
  - Keep scripts in the scratchpad.
- **Git:** don't commit or push. Report the files, any deviations and the verification results, concisely.
