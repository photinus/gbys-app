# Sprint 1 Implementation Plan (Scaffold, Auth, Households, Credential Vault)

Source of truth for parallel workers. Invariants live in `AGENT_HANDOFF.md`. UI reference: `assets/ui-mockup.html`.

Decisions: single-org deployment for now (no `organizations` table; revisit before Sprint 3). A "household" is the set of athletes a user is linked to via `household_guardians`. No separate households table.

## 1. Fixes to existing stubs (W2 owns unless noted)

**Auth (`src/lib/auth.ts`)**: add `nextCookies()` (from `better-auth/next-js`) as the LAST plugin; magicLink `expiresIn: 600`; register Google only when `GOOGLE_CLIENT_ID` is set; set `baseURL: process.env.BETTER_AUTH_URL` and `trustedOrigins`. Drizzle adapter mapping is already correct.
**`src/lib/auth-client.ts`**: create (contract below).
**Soft-deleted users** (`users.deletedAt`) must not get a session context.

**Schema**
- `athletes.dateOfBirth` -> `date("date_of_birth", { mode: "string" })` (invariant 9; no TZ shift). No migrations exist yet.
- New `household_invites` table in `household.ts` (see below).
- New `src/db/schema/relations.ts` with Drizzle `relations()`; export from schema index. `userCredentials` has two links to `users` (owner + verifier) -> use `relationName`.
- `.$onUpdate(() => new Date())` on `users.updatedAt`, `athletes.updatedAt`; add `updatedAt` to `user_credentials`.
- `audit_logs`: add indexes on `(target_type, target_id)` and `actor_user_id`.
- `user_credentials.verifiedByUserId/verifiedAt` = "reviewed by/at" for both approve AND reject (comment it; do not rename).

**email.ts**: create the Nuntly client lazily; when `NUNTLY_API_KEY` missing, log email to console instead of sending; add `escapeHtml` and use in every template. **storage.ts**: lazy S3 client; `requestChecksumCalculation: "WHEN_REQUIRED"`, `responseChecksumValidation: "WHEN_REQUIRED"`; signed PUT includes `ContentLength`; content-type allowlist. **seed.ts**: guard `resources` insert by select-by-name (no dup on re-run). **drizzle.config.ts**: `import "dotenv/config"`.
**Fonts**: self-host via `@fontsource-variable/plus-jakarta-sans` (no `next/font/google`).
**Admin URLs**: `src/app/(admin)/admin/compliance/page.tsx` -> `/admin/compliance`.
**Layouts don't run for server actions**: every admin DAL fn / action re-checks role itself.
**`server-only`**: import in DAL files and `audit.ts`; NOT in `src/db/index.ts` (seed runs under tsx).
Only `src/lib/dal/**`, `src/lib/auth.ts`, `src/db/seed.ts`, `src/lib/audit.ts` may import `db`. (`dal/facilities.ts` lacks ctx checks: flagged for Sprint 3, leave.)
Ops note: Railway bucket needs a CORS rule allowing PUT from the app origin.

## 2. Shared contracts

**package.json / tsconfig / .gitignore**: already done by orchestrator (deps installed). W1 may add deps only if truly needed.

**`src/db/index.ts`** adds: `export type Db = typeof db; export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0]; export type DbOrTx = Db | DbTx;`

**`src/lib/dal/context.ts` (W2)**
```ts
import "server-only";
export type OrgRole = "super_admin" | "board_member" | "member";
export type ProgramRole = (typeof programRoleEnum.enumValues)[number];
export interface ProgramRoleGrant { programId: string; seasonId: string | null; role: ProgramRole }
export interface SessionContext { userId: string; email: string; name: string; image: string | null; orgRole: OrgRole; programRoles: ProgramRoleGrant[] }
export class DalError extends Error { constructor(public code: "UNAUTHENTICATED"|"FORBIDDEN"|"NOT_FOUND"|"INVALID", message?: string) }
export const getSessionContext: () => Promise<SessionContext | null>; // React cache(); auth.api.getSession({headers: await headers()}) + users row (deletedAt null) + program_roles
export async function requireSession(nextPath?: string): Promise<SessionContext>;      // redirect(`/sign-in?next=...`)
export async function requireOrgRole(...roles: OrgRole[]): Promise<SessionContext>;     // throws DalError("FORBIDDEN")
export function isBoard(ctx: SessionContext): boolean;                                   // super_admin | board_member
export function hasProgramRole(ctx: SessionContext, programId: string, roles?: ProgramRole[]): boolean;
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
export async function runAction<T>(fn: (ctx: SessionContext) => Promise<T>): Promise<ActionResult<T>>; // requireSession + map DalError/ZodError to error string
```

**`src/lib/audit.ts` (W2)**
```ts
export type AuditAction = "medical.viewed"|"medical.updated"|"athlete.created"|"profile.updated"
 |"guardian.invited"|"guardian.invite_revoked"|"guardian.invite_accepted"|"guardian.removed"
 |"credential.submitted"|"credential.proof_viewed"|"credential.verified"|"credential.rejected"|"compliance.queue_viewed";
export type AuditTarget = "athlete"|"user"|"household_invite"|"user_credential"|"compliance_queue";
export async function writeAudit(e: { actorUserId: string | null; action: AuditAction; targetType: AuditTarget; targetId: string; metadata?: Record<string, unknown> }, tx?: DbOrTx): Promise<void>;
```

**`household_invites` (W2, in `household.ts`)**: `id uuid pk`, `invitedByUserId text -> users`, `email text` (lowercased), `relationship text`, `athleteIds jsonb $type<string[]>`, `canRegister/canSignWaivers/receivesComms bool`, `tokenHash text unique` (sha256 of base64url token from 32 random bytes; raw token never stored), `expiresAt timestamptz`, `acceptedAt`, `acceptedByUserId`, `revokedAt`, `createdAt`, index on `email`.

**email.ts additions (W2)**: `sendGuardianInviteEmail({ to, inviterName, athleteNames, acceptUrl })`, `sendCredentialReviewedEmail({ to, name, credentialName, decision: "verified"|"rejected", notes? })`.

**storage.ts (W2)**: `ALLOWED_PROOF_TYPES` (pdf, png, jpeg, webp, heic), `MAX_PROOF_BYTES = 10 MB`, `credentialKeyPrefix(userId)` -> `credentials/${userId}/`, `getCredentialUploadUrl({ userId, fileName, contentType, contentLength }) -> { uploadUrl, objectKey }`, `getPrivateDocumentReadUrl(objectKey)`.

**`src/lib/auth-client.ts` (W2)**
```ts
import { createAuthClient } from "better-auth/react";
import { magicLinkClient, inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./auth";
export const authClient = createAuthClient({ plugins: [magicLinkClient(), inferAdditionalFields<typeof auth>()] });
export const { signIn, signOut, useSession } = authClient;
```

**`src/lib/safe-redirect.ts` (W2)**: `safeNext(next?: string): string` - only same-origin paths starting with a single `/`.

**`src/lib/format.ts` (W1)**, America/Los_Angeles via `Intl`, no new dep: `formatDate(d)`, `formatDateTime(d)`, `formatDob(dateStr)` (date-only, no TZ shift), `laDateInputToUtc(yyyyMmDd, endOfDay = true): Date`, `utcToLaDateInput(d): string`, `daysUntil(d): number`.

**UI primitives (W1)** in `src/components/ui/*` using `cn()` from `src/lib/utils.ts`:
`Button` (variant primary|secondary|ghost|danger, size sm|md, pill, native button props); `Card`, `CardHeader({title, description?, action?})`; `Badge({tone: neutral|success|warning|danger|info})`; `Input`, `Textarea`, `Select` (native), `Label`, `Field({label, hint?, error?, children})`, `Switch` (styled checkbox); `Modal({open,onClose,title,description?,children,footer?})` (client, native `<dialog>`); `Sheet({open,onClose,title,subtitle?,children,footer?})` (right slide-over); `Table, THead, TH, TBody, TR, TD`; `KpiCard({icon,label,value,delta?,hint?,tone: periwinkle|sage|coral|amber})`; `PastelCard({tone: lavender|peach|mint, title, children, action?})`; `EmptyState({title,description?,action?})`; `ToastProvider` + `useToast()`.

**Shell (W1)**: `AppShell({ user: {name,email,image: string|null,orgRole}, children })` (server) renders client `Sidebar` (icon rail, active from `usePathname`), `TopBar` with `PillTabs`, `UserMenu` (calls `signOut()` from `@/lib/auth-client` then goes to `/sign-in`). `getNavItems(orgRole)` in `src/components/shell/nav.ts`: members get Dashboard `/dashboard`, Household `/household`, Credentials `/volunteer/credentials`; board/super_admin also Compliance `/admin/compliance`.

**Design tokens (W1)** `src/app/globals.css`: `@import "tailwindcss"; @theme {...}`: colors alabaster #F4F3EF, shell #FAF9F6, charcoal #1C1C1E, periwinkle #95A9F9, sage #8CE09B, coral #F79A93, amber-soft #F6B982, lavender-card #ECEBFA, peach-card #F6EAE1, mint-card #E6F2EA, line #E6E4DD, line-soft #F1EFE9, rail #F7F6F2; `--font-sans: "Plus Jakarta Sans Variable", Inter, sans-serif`; `--radius-card: 26px`, `--radius-kpi: 24px`; `--shadow-card: 0 2px 12px rgba(0,0,0,0.02)`. Body alabaster/charcoal; port mockup's thin scrollbars.

**Server action convention**: `actions.ts` with `"use server"`; validate with zod, then `runAction(ctx => dal.fn(ctx, input))`, then `revalidatePath`; return `ActionResult`; client forms use `useActionState`.

## 3. Workstreams

### W1 - Scaffold, design system, shell (Phase 0)
Create: `next.config.ts` (`eslint.ignoreDuringBuilds: true`), `postcss.config.mjs` (`{ plugins: { "@tailwindcss/postcss": {} } }`), `src/app/globals.css`, `src/app/layout.tsx` (imports fontsource, html/body, metadata, wraps `ToastProvider`), `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/(public)/layout.tsx`, `src/app/(public)/page.tsx` (landing with "Sign in" button -> `/sign-in`), `src/lib/utils.ts`, `src/lib/format.ts`, all `src/components/ui/*`, all `src/components/shell/*`. NO `src/app/page.tsx`.
Acceptance: `/` renders in mockup style (Plus Jakarta, alabaster bg, pill buttons); typecheck passes on its own files.

### W2 - Data layer + auth core (Phase 0), then auth UI + layouts (Phase 1)
Phase 0: all section-1 fixes; `relations.ts`; `db/index.ts` types; seed; drizzle config; auth.ts, email.ts, storage.ts; auth-client.ts, dal/context.ts, audit.ts, safe-redirect.ts; `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler(auth)` from `better-auth/next-js`); `src/middleware.ts` (optimistic `getSessionCookie(req)` from `better-auth/cookies`; matcher `/dashboard/:path*`, `/household/:path*`, `/volunteer/:path*`, `/admin/:path*`; no cookie -> `/sign-in?next=<path>`); run `npx drizzle-kit generate`.
Phase 1: `(auth)/layout.tsx`, `(auth)/sign-in/page.tsx` (+ `sign-in-form.tsx` client: Google social + magic link + "check your email" state; `next`/`error` via `safeNext`), `(portal)/layout.tsx` (`requireSession()` -> AppShell), `(portal)/dashboard/page.tsx` (greeting + pastel cards linking to Household and Credentials), `(admin)/layout.tsx` (`requireOrgRole("super_admin","board_member")`, non-board -> `notFound()`), `(admin)/admin/page.tsx` (redirect to `/admin/compliance`).
Acceptance: drizzle generate SQL includes `household_invites` and `date_of_birth date`; seed twice = no dups; unauthenticated `/household` redirects to `/sign-in?next=/household`; nothing throws at import with missing env vars.

### W3 - Households (Phase 1)
Create: `src/lib/validation/household.ts` (zod: `profileSchema` name/phone E.164-ish optional/smsOptIn; `athleteSchema` first/last, DOB `YYYY-MM-DD` in the past, gender, grade, medicalNotes <=2000, emergencyContacts 1-5 of {name,phone,relationship}; `inviteSchema` email, relationship, athleteIds>=1, three permission bools), `src/lib/dal/households.ts`, `src/app/(portal)/household/page.tsx`, `.../household/actions.ts`, `.../household/invite/[token]/page.tsx` (+ accept button), `src/components/household/{profile-card,athlete-table,athlete-form-modal,athlete-detail-sheet,emergency-contacts-fields,invite-guardian-modal,pending-invites-list,guardian-list}.tsx`.
DAL (all take `ctx` first): `getMyProfile`, `updateMyProfile` (audit profile.updated); `listMyAthletes` (NO medical fields; `hasMedicalNotes` boolean only); `getAthleteDetail` (guardian or isBoard; ALWAYS audit medical.viewed); `createAthlete` (tx: athlete + guardian row with all perms + audit athlete.created); `updateAthlete` (guardian w/ canRegister; audit medical.updated if medical/contacts changed); `listGuardians`, `removeGuardian` (never remove last guardian; audit); `createGuardianInvite` (inviter needs canRegister on every athleteId; 7-day expiry; email link `${BETTER_AUTH_URL}/household/invite/${token}`; audit); `listMyPendingInvites`, `revokeInvite`; `getInviteForAccept`, `acceptGuardianInvite` (sha256 lookup; not expired/revoked/accepted; lowercase(ctx.email) === invite.email; tx insert household_guardians onConflictDoNothing + mark accepted; audit).
UI: profile card (phone + SMS switch), athlete roster table in mockup style (detail sheet = audited read), add-athlete modal with repeatable emergency contacts, co-guardian list, invite modal, pending invites w/ revoke.
Acceptance: typecheck + build pass; page never imports `db`; list query never selects `medicalNotes`/`emergencyContacts`.

### W4 - Credential vault + compliance queue (Phase 1)
Create: `src/lib/validation/compliance.ts` (`uploadRequestSchema` definitionId/fileName/contentType in ALLOWED_PROOF_TYPES/size<=MAX_PROOF_BYTES; `submitCredentialSchema` definitionId, issuerPartner, referenceNumber, issuedAt, optional expiresAt, proofObjectKey; `reviewSchema` decision, reviewerNotes required on reject, optional expiresAt), `src/lib/dal/compliance.ts`, `src/app/(portal)/volunteer/page.tsx` (redirect to `/volunteer/credentials`), `.../volunteer/credentials/{page,actions}.tsx|ts`, `src/app/(admin)/admin/compliance/{page,actions}.tsx|ts`, `src/components/compliance/{credential-status-badge,my-credentials-table,upload-credential-modal,verification-queue-table,review-sheet,compliance-kpis}.tsx`.
DAL: `listCredentialDefinitions`, `listMyCredentials` (joined w/ definition), `createProofUploadUrl`, `submitCredential` (objectKey must start with `credentialKeyPrefix(ctx.userId)`; expiresAt defaults to issuedAt + defaultValidityMonths; status pending_review; audit credential.submitted), `getCredentialProofUrl` (owner or isBoard; audit credential.proof_viewed), `listVerificationQueue(ctx, filter?)` (board check inside; one audit compliance.queue_viewed per call), `reviewCredential(ctx, id, {decision, reviewerNotes?, expiresAt?})` (board only; not own credential; must be pending_review; sets verifiedByUserId/verifiedAt; audit; sends `sendCredentialReviewedEmail`), `getComplianceSummary` (board only: pending, verified, expiringIn30, expired).
Upload flow (client): `createProofUploadUrl` -> `fetch(uploadUrl,{method:"PUT",headers:{"Content-Type":file.type},body:file})` -> `submitCredential`. Dates via `laDateInputToUtc`.
Admin page: KPI cards, status filter pills, queue table, review sheet (details, audited "View proof", approve/reject; notes required on reject).
Acceptance: typecheck + build pass; every admin action re-checks board role inside DAL; reviewer cannot approve own credential.

## 4. Verification
After merge: `npm run typecheck` and `next build` with no `.env`. Authenticated pages call `headers()` so build never touches Postgres. Local Postgres 16 (cluster `16 main`, port 5432, stopped): `pg_ctlcluster 16 main start`, `createdb gbys`, set `.env`, `npm run db:migrate`, `npm run db:seed` x2, `next dev`, sign in via `[DEV MAGIC LINK]` console URL, promote user with psql, exercise flows, check `audit_logs`. Not testable locally: Google OAuth, browser PUT to Railway S3/CORS, Nuntly delivery.
