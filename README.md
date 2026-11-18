# Gold Beach Youth Sports (GBYS) App

Volunteer-run youth sports management platform: households and athletes, volunteer
credential vault and board compliance queue (Sprint 1). See `AGENT_HANDOFF.md` for the
product spec and invariants, `ARCHITECTURE.md` for the layout, and `docs/SPRINT1_PLAN.md`
for the Sprint 1 implementation plan. UI reference: `assets/ui-mockup.html`.

## Local development

```bash
cp .env.example .env        # set DATABASE_URL, BETTER_AUTH_SECRET (32+ chars), BETTER_AUTH_URL
npm install
npm run db:migrate          # apply drizzle/ migrations
npm run db:seed             # credential definitions + sample facilities (idempotent)
npm run dev
```

In development, magic-link sign-in URLs are printed to the server console
(`[DEV MAGIC LINK]`). Promote a user to the board to see `/admin/compliance`:

```sql
update users set org_role = 'board_member' where email = 'you@example.org';
```

Checks: `npm run typecheck` and `npm run build`.

## Deploying (Railway)

- `web` builds from `main`. Set the pre-deploy command to `npm run db:migrate:prod`
  (runs `scripts/migrate.mjs` using production dependencies only).
- Required variables: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CRON_SECRET`,
  `S3_*`. Optional until configured: `GOOGLE_CLIENT_ID/SECRET` (Google button is hidden
  without it) and `NUNTLY_API_KEY` (emails are logged to the console without it).
- The S3 bucket needs a CORS rule allowing `PUT` from the app origin (browser proof uploads).
