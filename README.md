# Gold Beach Youth Sports (GBYS) App

Volunteer-run youth sports management platform: households and athletes, volunteer
credential vault and board compliance queue (Sprint 1); volunteer shifts with kiosk
check-in, the grant-auditable hours ledger, grant exports, program roles and the
daily compliance cron (Sprint 2); seasons with a custom form builder, public
registration with versioned waiver e-signatures, offline (cash/check/scholarship)
payments and an offline-capable coach emergency sheet (Sprint 3a); admin overview, user management,
org settings and branding, credential types, an audit log viewer and a grouped,
collapsible sidebar (Admin & Navigation); volunteer roles with expected hours per
season or year, sign-up/approval and grant commitment reporting (Volunteer Roles). See `AGENT_HANDOFF.md` for the
product spec and invariants, `ARCHITECTURE.md` for the layout, and `docs/SPRINT1_PLAN.md`
`docs/SPRINT2_PLAN.md` `docs/SPRINT3A_PLAN.md` `docs/ADMIN_NAV_PLAN.md` and `docs/VOLUNTEER_ROLES_PLAN.md` for the sprint implementation plans. UI reference: `assets/ui-mockup.html`.

## Local development

```bash
cp .env.example .env        # set DATABASE_URL, BETTER_AUTH_SECRET (32+ chars), BETTER_AUTH_URL
npm install
npm run db:migrate          # apply drizzle/ migrations
npm run db:seed             # credential definitions + sample facilities (idempotent)
npm run dev
```

In development, magic-link sign-in URLs are printed to the server console
(`[DEV MAGIC LINK]`). Promote your first super admin with SQL (after that, use `/admin/users`):

```sql
update users set org_role = 'super_admin' where email = 'you@example.org';
```

Checks: `npm run typecheck` and `npm run build`.

## Sign in with Apple setup

Optional. The button appears only when `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` and
`APPLE_PRIVATE_KEY` are all set.

1. In the Apple Developer account, go to Certificates, Identifiers & Profiles, then Identifiers.
   Create an **App ID** with the "Sign in with Apple" capability enabled.
2. Create a **Services ID** (this identifier is `APPLE_CLIENT_ID`). Enable "Sign in with Apple" and
   Configure it: primary App ID = the App ID above; Domains = `web-production-3f2daa3d.up.railway.app`
   (plus any custom domain); Return URL = `https://<domain>/api/auth/callback/apple`
   (one per domain).
3. Under Keys, create a key with "Sign in with Apple" (choose the App ID). Download the `.p8` once;
   Apple will not show it again. The Key ID is `APPLE_KEY_ID`; your Team ID (top right of the
   developer account, or Membership) is `APPLE_TEAM_ID`.
4. On Railway set `APPLE_PRIVATE_KEY` to the `.p8` contents (multi-line paste works, or one line with
   `\n` for newlines). The app mints Apple's ES256 client secret from it at startup, so there is
   nothing to rotate; every redeploy regenerates it (a process that runs more than ~180 days needs a
   restart). `APPLE_APP_BUNDLE_ID` is only needed for a native iOS app.
5. Apple does not accept `localhost` or `http` return URLs, so test on the Railway domain.

**Hide My Email:** users who choose it get an `@privaterelay.appleid.com` address. Mail to that address
is dropped unless the sender is registered: in Apple Developer, go to Sign in with Apple for Email
Communication and add the sending domain/address (the domain of `NUNTLY_FROM_EMAIL`), with SPF and DKIM
set up for it. Without this, magic links and notifications never reach those users.

## Deploying (Railway)

- `web` builds from `main`. Set the pre-deploy command to `npm run db:migrate:prod`
  (runs `scripts/migrate.mjs` using production dependencies only).
- Required variables: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`,
  `S3_*`. Optional until configured: `GOOGLE_CLIENT_ID/SECRET` (Google button is hidden
  without it), `APPLE_*` (see below; Apple button is hidden unless all four are set) and `NUNTLY_API_KEY` (emails are logged to the console without it).
- The S3 bucket needs a CORS rule allowing `PUT` from the app origin (browser proof uploads).
- `cron-compliance` POSTs to `http://$WEB_PRIVATE_DOMAIN:<web port>/api/cron/compliance` with
  `Authorization: Bearer $CRON_SECRET` (same `CRON_SECRET` on both services). The port must
  match the port `web` listens on (currently 8080).
- Waivers: the editor's pre-filled text is a DRAFT TEMPLATE and cannot be saved unedited.
  Have counsel approve the waiver before opening registration. Saved waiver versions and
  signatures are immutable; changing a waiver creates a new version.
- The coach emergency sheet is cached on the device by `public/sw.js` for offline use
  (14-day expiry, purged on sign-out). No other page or API response is cached.
- Feature flags (server env): `FEATURE_VOLUNTEER_SHIFTS=true` re-enables shift scheduling
  (sign-up, manage shifts, kiosk check-in). Off by default; volunteer roles replace it.
