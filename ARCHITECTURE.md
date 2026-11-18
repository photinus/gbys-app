# System Architecture & Directory Blueprint

## Repository Layout
```text
gbys-platform/
├── drizzle/                      # Generated SQL migrations (drizzle-kit)
├── drizzle.config.ts             # Drizzle Kit configuration
├── .env.example                  # Required Railway, Better Auth, Stripe, Nuntly, S3 vars
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   │   └── sign-in/          # Google OAuth + Nuntly Magic Link UI
│   │   ├── (public)/
│   │   │   ├── page.tsx          # GBYS landing & open programs directory
│   │   │   └── register/[slug]/  # Dynamic season registration + waiver signature
│   │   ├── (portal)/
│   │   │   ├── household/        # Manage athletes, medical info, co-guardians
│   │   │   ├── volunteer/        # Shift sign-up, hour logger, credential uploads
│   │   │   └── programs/[slug]/  # Schedules, rosters, offline emergency sheet
│   │   ├── (admin)/
│   │   │   ├── compliance/       # First Advantage & cert approval queue
│   │   │   ├── grants/           # Volunteer hour rollups & CSV/PDF grant exports
│   │   │   ├── facilities/       # Hierarchical resource & conflict calendar
│   │   │   └── stripe/           # Stripe Connect onboarding for partner leagues
│   │   └── api/
│   │       ├── auth/[...all]/    # Better Auth catch-all route handler
│   │       ├── webhooks/
│   │       │   ├── stripe/       # PaymentIntent, Refund & Connect account webhooks
│   │       │   └── nuntly/       # Email delivered & bounced event webhooks
│   │       └── cron/
│   │           └── compliance/   # Daily Railway cron for expiring credentials
│   ├── db/
│   │   ├── index.ts              # PostgreSQL pool & Drizzle client
│   │   ├── seed.ts               # Initial credential_definitions & sample resources
│   │   └── schema/
│   │       ├── index.ts          # Barrel export of all tables & relations
│   │       ├── auth.ts           # Better Auth tables + extended users fields
│   │       ├── household.ts      # athletes, household_guardians
│   │       ├── programs.ts       # programs, seasons, program_roles
│   │       ├── compliance.ts     # credential_definitions, user_credentials
│   │       ├── volunteers.ts     # volunteer_shifts, volunteer_logs
│   │       ├── registration.ts   # registrations, signed_waivers, webhook_events
│   │       └── facilities.ts     # resources, resource_bookings, audit_logs
│   ├── lib/
│   │   ├── auth.ts               # Better Auth server instance
│   │   ├── auth-client.ts        # Better Auth React client
│   │   ├── dal/                  # Scoped Data Access Layer (enforces permissions)
│   │   │   ├── context.ts        # Session & role loader helper
│   │   │   ├── households.ts
│   │   │   ├── compliance.ts
│   │   │   ├── volunteers.ts
│   │   │   ├── registrations.ts
│   │   │   └── facilities.ts
│   │   ├── stripe.ts             # Stripe & Stripe Connect SDK helpers
│   │   ├── storage.ts            # S3 client for Railway Object Storage
│   │   ├── email.ts              # @nuntly/sdk email sender wrapper
│   │   └── audit.ts              # Audit log writer helper
│   └── components/               # Shared UI, PWA offline sync, dynamic form renderer
└── package.json
```

## Railway Service Topology
1. **`web` (Next.js App):** Deployed from GitHub `main` branch. Connects to Postgres over `DATABASE_URL` (private network).
2. **`postgres` (Managed PostgreSQL):** Enable automated daily backups immediately upon provisioning.
3. **`cron-compliance` (Railway Cron Service):**
   - Schedule: `0 15 * * *` (7:00 AM PST / 8:00 AM PDT)
   - Target: `POST https://${{web.RAILWAY_PRIVATE_DOMAIN}}/api/cron/compliance`
   - Auth: `Authorization: Bearer ${CRON_SECRET}`
   - Behavior: Marks credentials with `expiresAt < now()` as `expired`, sends 30-day and 7-day expiration warning emails via Nuntly, and alerts program admins if an active coach loses compliance.
