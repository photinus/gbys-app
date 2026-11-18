# Admin & Navigation Sprint Plan

This plan binds the parallel workers. Invariants live in `AGENT_HANDOFF.md`; numbers 2, 4 and 9 matter most here. The conventions from earlier sprints still apply:

- DAL functions take `ctx` first and authorize inside the function.
- Actions follow zod → `runAction` → `revalidatePath` → `ActionResult`.
- Forms use `useActionForm` (`src/components/household/use-action-form.ts`).
- UI uses only `src/components/ui/*`, in the mockup style.
- Dates display in LA time.
- No page may overflow horizontally at 390px.

## 0. Done by the orchestrator (read it; don't redo it)

- **Schema (migration `0006`):**
  - `org_settings` is a singleton: `id` must be 1, and the migration inserts that row.
  - Branding columns: `orgName`, `shortName`, `legalDesignation`, `ein`, `supportEmail` and `websiteUrl`.
  - Rate columns: `inKindHourlyRateCents` (null means fall back to the env variable; must be between 100 and 50000) and `inKindRateSource`.
  - Logo columns: `logo` (bytea), `logoContentType` and `logoUpdatedAt`. `updatedByUserId` records the last editor.
  - `credential_definitions` gets `isActive`, `createdAt` and `updatedAt`.
- **`src/lib/dal/settings.ts` (shared contract; the WS worker extends this file):**
  - `getBranding()`, typed as `Branding`. It is public, cached per request, and never throws: on error it returns `DEFAULT_BRANDING`. Its `logoUrl` is `/brand/logo?v=<ms>` when a logo exists, otherwise null, in which case the built-in emblem is shown.
  - `getInKindRateCents()`: returns the DB value, else the env value, else 3349.
- **`src/lib/dal/permissions.ts`:** adds `isSuperAdmin(ctx)`.
- **`src/lib/audit.ts`:**
  - New actions:
    - `user.role_changed`, `user.profile_updated`, `user.deactivated`, `user.restored`
    - `settings.updated`, `branding.logo_updated`, `branding.logo_removed`
    - `credential_definition.created`, `credential_definition.updated`, `credential_definition.archived`, `credential_definition.restored`
    - `audit.viewed`
  - New targets: `org_settings`, `credential_definition`, `audit_log`.

## 1. Authorization rules (enforce them in the DAL)

- **Board** (`super_admin` or `board_member`) can see every admin page. Board members can also:
  - deactivate or restore users;
  - edit a user's name or phone;
  - manage credential types and settings, including the logo and the in-kind rate;
  - view the audit log.
- **Org-role changes are super-admin only.** That covers promoting or demoting anyone between `member`, `board_member` and `super_admin`. Guard rails:
  - Nobody can change their own role or deactivate themselves.
  - The last active super admin can't be demoted or deactivated. Check this under a lock, using `SELECT ... FOR UPDATE` on the active super-admin rows or an advisory lock.
  - Deactivating a board member or super admin also requires super admin.
- **Email can't be edited.** It is the auth identity.

## 2. Workstreams (parallel; no file overlap)

### WN: Sidebar navigation, app shell and branding
**Owns:**
- `src/components/shell/**`. You may delete `pill-tabs.tsx`. Keep `clearSensitiveCaches()` in sign-out.
- The layouts: `src/app/(portal)/layout.tsx`, `src/app/(admin)/layout.tsx`, `src/app/(auth)/layout.tsx`, `src/app/(public)/layout.tsx` and `src/app/layout.tsx` (add `generateMetadata`, with the title template `%s · <shortName>`).

**Nav model** (`nav.ts`):
- `getNavGroups(orgRole, { isShiftCoordinator, isProgramStaff })` returns `NavGroup[]` (`{ id, title, items: NavItem[] }`). Drop empty groups.
- Groups and items, in order:
  - **Overview:** Dashboard `/dashboard`
  - **My family:** Household `/household`, Registrations `/registrations`
  - **Volunteer:** Credentials `/volunteer/credentials`, Shifts `/volunteer/shifts`, Hours `/volunteer/hours`
  - **Programs** (staff or coordinator): My programs `/programs` (staff), Manage shifts `/volunteer/shifts/manage` (coordinator)
  - **Administration** (board): Overview `/admin`, Users `/admin/users`, Compliance `/admin/compliance`, Hours review `/admin/hours`, Grants `/admin/grants`, Programs `/admin/programs`, Settings `/admin/settings`, Audit log `/admin/audit`
- Keep the `isActivePath` most-specific-match behaviour, so `/admin` doesn't light up on `/admin/users`.

**Sidebar (desktop, `lg` and up):**
- Sticky and full height, in the mockup's rail colours (`bg-rail`, `border-line`, the active pill `bg-periwinkle/35`, pill items).
- **Expanded (about 248px):** logo plus org name at the top; group titles as small uppercase stone-400 labels; icon plus label rows.
- **Collapsed (about 80px):** the icon-only rail, same as today. Group titles become thin dividers, and each item has a tooltip (`title`) and an `aria-label`.
- A collapse/expand toggle button sits at the bottom.
- The state lives in the cookie `gbys_sidebar=collapsed|expanded`, a year long. `AppShell` reads it with `cookies()` and renders the right width server-side, so there is no flash. The client toggle writes the cookie and updates local state immediately.
- Animate the width with a short transition, respecting `prefers-reduced-motion`.

**Mobile (below `lg`):**
- A slim sticky top bar holds a hamburger button, the logo plus short name, and the user menu.
- The hamburger opens a slide-in drawer: the expanded sidebar with all groups, closing on backdrop click, Esc and route change. Use focus trapping or native `<dialog>` like `Sheet`.
- Remove the pill tabs entirely.

**Top bar (desktop):** only the user menu on the right, plus an optional page-level breadcrumb slot. Keep it minimal; no search yet.

**Branding:**
- `Logo` takes `logoUrl` and renders the uploaded image (a plain `<img>`, contained in the same 44px rounded square) or the built-in SVG emblem.
- The org name comes from `getBranding()` on the sidebar, mobile bar, auth layout, public layout header and footer, and in metadata. Replace every hard-coded "Gold Beach Youth Sports" in the files you own.

**Print:** the shell stays `print:hidden`.

### WS: Settings, logo, credential types and in-kind rate
**Owns:**
- `src/lib/dal/settings.ts`: extend it, keeping `getBranding`, `DEFAULT_BRANDING` and `getInKindRateCents` unchanged.
- `src/lib/validation/settings.ts`
- `src/lib/dal/credential-types.ts` and `src/lib/validation/credential-types.ts`
- `src/app/(admin)/admin/settings/**`: `page.tsx`, `actions.ts`, `credentials/page.tsx`, `credentials/actions.ts`
- `src/app/brand/logo/route.ts`
- `src/components/settings/**`
- **Edits to other modules (only you touch these files this sprint):**
  - `src/lib/dal/shifts.ts` and `src/lib/dal/volunteer-hours.ts`: replace `currentInKindRateCents()` with `await getInKindRateCents()`. In `shifts.ts`, read the rate before or inside the transaction.
  - `src/lib/dal/grants.ts`: rows with a null rate fall back to `await getInKindRateCents()`, and so does the current-rate statement.
  - `src/lib/dal/compliance.ts`: `listCredentialDefinitions` returns active types only, for new submissions. Existing credentials of archived types must still list and display.
  - `src/lib/dal/programs.ts`: `listCredentialOptions` returns active types plus any archived ones already required by that program, marked as archived.
  - `src/app/(admin)/admin/grants/print/page.tsx`: the header comes from `getBranding()`: org name, legal designation, and the EIN if set.

**DAL:**
- `getOrgSettings(ctx)` (board).
- `updateOrgSettings(ctx, input)` (board):
  - Fields: name (2–80), short name (2–12), legal designation, EIN (`NN-NNNNNNN`, optional), support email, website URL (https only), in-kind rate entered in dollars and stored as cents (1.00–500.00, or blank to use the default), and the rate source.
  - Audit `settings.updated` with the changed field names. For the rate, record its old and new values.
- `uploadLogo(ctx, file)` (board):
  - Accept `FormData` with a File: png, jpeg or webp only, at most 512 KB.
  - Check the type by **sniffing the magic bytes**, not just by the declared type.
  - Store the bytes in `org_settings.logo` and set `logoUpdatedAt`.
  - Audit `branding.logo_updated`.
- `removeLogo(ctx)` (board): audit `branding.logo_removed`.
- `src/app/brand/logo/route.ts` (GET, public):
  - Stream the bytes with the stored content type.
  - Headers: `Cache-Control: public, max-age=31536000, immutable` (the URL carries `?v=`), `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
  - Return 404 when there is no logo.
- Credential types (board):
  - `listCredentialTypesAdmin(ctx)`: all types, with counts of credentials (total and verified) and the programs requiring each.
  - `createCredentialType(ctx, { code, name, description, defaultValidityMonths })`: the code is lowercase snake_case, unique and **immutable after creation**; validity is 1–120 months.
  - `updateCredentialType(ctx, id, { name, description, defaultValidityMonths })`: a validity change applies to new submissions only.
  - `archiveCredentialType` and `restoreCredentialType`. When archiving, warn which programs still require the type. No hard delete is offered.
  - Every write is audited.

**UI:**
- `/admin/settings` has three cards:
  - Organization profile.
  - Branding: a logo preview, upload and remove, and a note on recommended size (a square PNG of at least 256px).
  - Volunteer valuation: the rate, its source, a "default from environment" hint, and an explanation that existing ledger entries keep their rate.
- The page links to "Credential types".
- `/admin/settings/credentials`: a table with archived badges, create and edit modals, and archive/restore with a confirmation.

### WU: User management
**Owns:**
- `src/lib/dal/users-admin.ts` and `src/lib/validation/users-admin.ts`
- `src/app/(admin)/admin/users/**`: `page.tsx`, `actions.ts`, `[id]/page.tsx`, `[id]/actions.ts`
- `src/components/users/**`

**DAL (board unless noted):**
- `listUsers(ctx, { q?, role?: OrgRole | "all", status?: "active" | "deactivated" | "all", page })`:
  - Search name and email case-insensitively.
  - 50 per page, newest first.
  - Each row: name, email, org role, active/deactivated, created date, last sign-in (max `sessions.createdAt`), program-role count, verified-credential count and email-bounced flag.
- `getUserAdmin(ctx, userId)`:
  - Profile: name, email, phone, SMS opt-in, email bounced, created and deactivated dates.
  - Org role and program roles (program name and role, linking to `/admin/programs/[id]`).
  - Credentials: type, status and expiry, with no proof URLs.
  - Hours YTD: verified minutes and value, using `inKindValueCents`.
  - Households: athlete count only. **No athlete names or medical data on this page.**
  - The last 20 audit rows where the user is the actor or the target user.
- `changeOrgRole(ctx, userId, role)`:
  - Super admin only. No self-change, and the last active super admin can't be demoted (checked under a lock).
  - Audit `user.role_changed` with `{ from, to }`.
- `updateUserProfileAdmin(ctx, userId, { name, phone })`: phone is normalised like the household profile (reuse `normalizePhone` from `src/lib/validation/household.ts`). Audit `user.profile_updated`.
- `deactivateUser(ctx, userId, reason)`:
  - Not yourself. Deactivating a board member or super admin requires super admin. The last active super admin can't be deactivated.
  - Set `deletedAt` and delete all of the user's `sessions` rows in the same transaction.
  - Audit `user.deactivated` with the reason.
  - The UI warns when the user is the only guardian of any athlete (show the count).
- `restoreUser(ctx, userId)`: clear `deletedAt`; audit `user.restored`.

**UI:**
- `/admin/users`: a search box, role and status filter pills, a table that becomes cards on mobile, and pagination.
- `/admin/users/[id]`:
  - A header with an avatar from initials, the name, email and role badge.
  - Sections: Profile (editable), Org role (a select shown only to super admins, otherwise read-only with "Only super admins can change roles"), Program roles, Credentials, Hours, Recent activity.
  - A danger zone with deactivate (reason modal) or restore.

### WO: Admin overview and audit log
**Owns:**
- `src/lib/dal/admin-overview.ts` and `src/lib/dal/audit-log.ts`
- `src/lib/validation/audit-log.ts`
- `src/app/(admin)/admin/page.tsx` (replace the current redirect)
- `src/app/(admin)/admin/audit/**`
- `src/components/admin/**`

**Overview** (`getAdminOverview(ctx)`, board) mirrors the mockup's admin dashboard:
- **Four KPI cards:**
  - Active volunteers: users with at least one verified, unexpired credential, with "+N this month" (credentials verified this LA month).
  - Registered athletes: live registrations in active seasons.
  - Volunteer hours YTD: verified minutes plus in-kind value, LA calendar year, excluding soft-deleted rows.
  - Partner leagues: active programs where `isIndependentPartner` is true.
- **Needs attention list** (count plus link):
  - Credentials pending review → `/admin/compliance`
  - Credentials expiring within 30 days
  - Self-reported hours pending → `/admin/hours`
  - Unpaid registrations in open seasons → each program hub
  - Users with bounced email → `/admin/users?…`
  - Seasons open with a waiver still containing "DRAFT" (a safety check)
- **Pastel cards:** "Upcoming shifts (next 7 days)" with the count and the next 3, and "Open registrations" with the seasons and their counts.
- A greeting header in the mockup's style.

**Audit log:**
- `listAuditLog(ctx, { action?, actorQuery?, targetType?, targetId?, from?, to?, cursor? })`:
  - Board only.
  - Keyset pagination on `(createdAt desc, id desc)`, 100 per page.
  - Join the actor's name and email. A null actor displays as "System".
  - LA date filters, inclusive.
  - Write **one** `audit.viewed` row per page load, with the filters. **Do not** write one per pagination click within the same filter set: only the first page counts, so skip when `cursor` is set.
- **UI** (`/admin/audit`):
  - A GET filter form: an action select built from distinct actions in the DB, an actor search, a target type, and a date range.
  - A table showing time (LA), actor, action, target and a metadata summary. Each row expands to show its pretty-printed metadata JSON.
  - Link a target to `/admin/users/[id]` when it's a user, `/admin/programs/[id]` when it's a program.
  - A "Load more" control using the cursor.
  - Highlight `medical.viewed` rows with a subtle badge.

## 3. Shared rules

- **Files:** only touch files you own. Never edit the schema, migrations, `audit.ts`, `permissions.ts`, `context.ts`, the middleware or `next.config.ts`. Report any missing contract.
- **Dev isolation:**
  - Run `next dev` and `next build` with `NEXT_DIST_DIR=.next-<ws>`, then `git checkout tsconfig.json` afterwards.
  - Leave no processes running.
- **Database isolation:**
  - Use your own database `gbys_<ws>` on localhost:5432 (user `postgres`, password `postgres`). If the server isn't running, start it with `pg_ctlcluster 16 main start`.
  - Run `DATABASE_URL=... npm run db:migrate:prod && npm run db:seed`.
  - Keep env vars in the shell only; never write `.env`. Drop the database when you're done.
- **Verification:**
  - `npx tsc --noEmit` and `next build`.
  - A DAL test script.
  - A Playwright pass through the magic-link dev login. Space sign-ins out, because they are rate-limited.
  - Check 390px for overflow.
  - Keep scripts in the scratchpad.
- **Git:** don't commit or push. Report the files, any deviations and the verification results, concisely.
