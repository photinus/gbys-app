# Sprint 3b Plan: Stripe Connect payments, webhooks, refunds, ledger (+ Nuntly bounces)

This plan binds the parallel workers. Invariants are in `AGENT_HANDOFF.md`; numbers 4 and 6 matter most here.

Earlier conventions still apply:
- DAL functions take `ctx` first and authorize inside. **The webhook is a system actor and is the allowed exception.**
- Actions follow zod → `runAction` → `revalidatePath` → `ActionResult`.
- Forms use `useActionForm`.
- UI uses only `src/components/ui/*`.
- Times display in LA, and pages must not overflow horizontally at 390px.

## User decisions
- **Charge model:**
  - GBYS-run programs (`isIndependentPartner = false`) charge on the **GBYS platform account**.
  - Partner programs use **direct charges** on their own **Standard** connected account, so the league is the merchant of record and handles refunds and disputes in its own dashboard.
- **Platform fee:** configured per partner program by the board. It is a flat amount plus basis points and defaults to $0. It is never charged on GBYS-run programs.
- **Card fees:** the program absorbs them. Families pay exactly the posted fee.
- **Card data:** families pay on Stripe-hosted Checkout, and the app never sees card data.

## 0. Done by the orchestrator (read it, don't redo it)

### Schema (migration `0012`)
- **`programs`:** `stripeChargesEnabled`, `stripeDetailsSubmitted`, `stripeAccountSyncedAt` and `platformFeeBps` are new. `stripeAccountId`, `stripeOnboardingComplete` and `platformFeeCents` already existed. A check constraint enforces fee ≥ 0 and bps between 0 and 3000.
- **`registrations`:** `stripeCheckoutSessionId`, `stripeAccountId` (snapshot of the charged account; null means platform), `platformFeeChargedCents`, `refundedCents` (default 0) and `disputedAt`. `stripePaymentIntentId` already existed.
- **`payment_events`:** an **append-only ledger**, protected by a DB trigger.
  - `kind` is one of `charge`, `refund`, `dispute_opened`, `dispute_closed`, `offline_payment`, `offline_void`.
  - Other columns: `amountCents ≥ 0`, `applicationFeeCents`, `stripeAccountId`, `method`, `note`, `recordedByUserId` (null means the webhook) and `occurredAt`.
  - `stripeObjectId` is **unique**, so a redelivered webhook can never double-count.
- **`webhook_events`** (already existed): `id` is the event id, plus provider and event type. Use it for idempotency.

### Code
- **`src/lib/stripe.ts`:**
  - `isStripeEnabled()`.
  - `getStripe()`: lazy, pinned to `2025-02-24.acacia`, with `maxNetworkRetries: 2`.
  - `__setStripeForTests(fake)`.
  - `computePlatformFeeCents(amount, program)`: unit-tested. Partner programs only, and the fee is always kept below the amount.
  - `paymentRouteFor(program)` returns either `{ ready, stripeAccountId | null }` or `{ ready: false, reason }`.
  - `stripeRequestOptions(acct)`.
- **Contracts (stubs to replace; keep the signatures):**
  - `src/lib/dal/stripe-connect.ts`: `handleAccountUpdated(account)`.
  - `src/lib/dal/stripe-refunds.ts`: `handleChargeRefunded(tx, charge, accountId)` and `handleDisputeEvent(tx, dispute, accountId, phase)`. The webhook calls these inside **its** transaction, which also inserted the `webhook_events` row.
- **Audit actions:** `payment.*`, `stripe.onboarding_started`, `stripe.account_updated`, `program.platform_fee_updated` and `user.email_bounced`.
- **`.env.example`:** `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (platform account events) and `STRIPE_CONNECT_WEBHOOK_SECRET` (connected-account events). `NUNTLY_WEBHOOK_SECRET` already existed.

### Testing reality
The sandbox **cannot reach api.stripe.com**:
- Inject a fake Stripe client via `__setStripeForTests`, or mock `fetch`.
- Build signed webhook payloads with `stripe.webhooks.generateTestHeaderString({ payload, secret })`.
- The real round trip is done later by the user with test cards and the Stripe CLI.

## 1. Workstreams (parallel; no file overlap)

### PA: Connect onboarding and payment settings
**Owns:**
- `src/lib/dal/stripe-connect.ts`: replace the stub and keep the `handleAccountUpdated` signature.
- `src/lib/validation/payments-settings.ts`
- `src/app/(portal)/programs/[slug]/payments/page.tsx` and `actions.ts`: setup and status.
- `src/app/(portal)/programs/[slug]/payments/return/route.ts` and `refresh/route.ts`: the Account Link return and refresh handlers.
- `src/components/payments-setup/**`
- An edit to `src/app/(admin)/admin/programs/[id]/page.tsx`: add a board **Payments** card for the platform fee and connection status.

**DAL:**
- **`getPaymentSetup(ctx, programId)`** (`canManageProgram`): returns the route (`paymentRouteFor`), the account id, and the charges-enabled and details-submitted flags. Also the fee config and a fee preview for the program's open seasons' fees, built with `computePlatformFeeCents`.
- **`startOnboarding(ctx, programId)`:**
  - Allowed for `canManageProgram`, partner programs only.
  - If the program has no `stripeAccountId`, create one with `stripe.accounts.create({ type: "standard", email?, business_profile: { name: program.name } })` and store it.
  - Call `stripe.accountLinks.create({ account, type: "account_onboarding", refresh_url: <app>/programs/<slug>/payments/refresh, return_url: <app>/programs/<slug>/payments/return })` and return its URL. Use `BETTER_AUTH_URL` as the app base.
  - Audit it.
  - Race-safe: lock the program row `FOR UPDATE`, so two clicks never create two accounts.
- **`refreshAccountStatus(ctx, programId)`:** `accounts.retrieve`, then sync the program.
- **`handleAccountUpdated(account)`** (system actor, called by the webhook):
  - Find the program by `stripeAccountId`. An unknown account is a no-op.
  - Set `stripeChargesEnabled = charges_enabled`, `stripeDetailsSubmitted = details_submitted`, `stripeOnboardingComplete` = both, and `stripeAccountSyncedAt`.
  - Audit `stripe.account_updated` with the before and after values.
- **`setPlatformFee(ctx, programId, { flatCents, bps })`:** **board only**, partner programs only, validated, and audited as `program.platform_fee_updated` with from and to values.
- **The return route** calls `refreshAccountStatus` and redirects to the payments page with a status message. **The refresh route** creates a new Account Link and redirects to it.

**UI (`/programs/[slug]/payments`, program admin or board):**
- **GBYS-run program:** "Card payments go to the GBYS account", plus whether Stripe is enabled.
- **Partner program:** "Connect Stripe" or "Continue setup" (when not ready), status badges, and a link to `https://dashboard.stripe.com` (Standard accounts use their own dashboard).
- Platform fee shown read-only, with a worked example, e.g. "On a $65 registration GBYS keeps $X; your league receives $Y before Stripe's processing fee".
- A link to the ledger (`/programs/[slug]/payments/ledger`, built by PC).
- **Board card on the admin program page:** fee inputs (dollars + percent) and status.

### PB: Checkout, webhooks and the Pay-now UX
**Owns:**
- `src/lib/dal/stripe-checkout.ts` and `src/lib/dal/stripe-webhook.ts`.
- `src/app/api/webhooks/stripe/route.ts` and `src/app/api/webhooks/nuntly/route.ts`.
- `src/app/(portal)/registrations/**`: the Pay now button, checkout return states and the existing page.
- `src/components/registration/**`: the confirmation step's Pay now.
- `src/components/dashboard/**` and `src/lib/dal/dashboard.ts`: Pay now on dues.
- `src/lib/dal/registrations.ts`: payment-related additions only, e.g. a `canPayOnline` flag in `listMyRegistrations`.

**Checkout** (`createCheckoutForRegistration(ctx, registrationId)`):
- **Who can call it:** a guardian of the athlete with `canRegister`. The registration must be live, `unpaid`, with `feeCents > 0`, and the route must be ready.
- **Reuse an open session:** if `stripeCheckoutSessionId` points to a session that's still `open` and unexpired, return its URL.
- **Otherwise create a session** with `checkout.sessions.create(...)`:
  - `mode: "payment"`, one line item (`unit_amount = feeCents`, name `"<Season> registration — <Athlete first name>"`).
  - `customer_email` set to the guardian.
  - `client_reference_id = registrationId`, and `metadata { registrationId, programId, seasonId }` on both the session and `payment_intent_data`.
  - For partner programs, `payment_intent_data.application_fee_amount = computePlatformFeeCents(...)` when it's above 0.
  - `success_url` is `<app>/registrations?checkout=success&session_id={CHECKOUT_SESSION_ID}` and `cancel_url` is `<app>/registrations?checkout=cancelled`.
  - `expires_at` is 1 hour.
  - Request options come from `stripeRequestOptions(acct)`, plus `idempotencyKey: "checkout:" + registrationId + ":" + attempt`.
- Store `stripeCheckoutSessionId`, `stripeAccountId` (snapshot) and `platformFeeChargedCents`. Audit `payment.checkout_started`.
- **Never** mark anything paid from the success URL. The page shows "Payment processing…" until the webhook lands. It may poll `listMyRegistrations` every few seconds, for up to about 30 s.

**Stripe webhook** (`POST /api/webhooks/stripe`, runtime nodejs, `force-dynamic`):
- **Verify the signature.** Read the raw body with `await req.text()`. Try `stripe.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)`, then `STRIPE_CONNECT_WEBHOOK_SECRET`. If neither matches, return 400. If neither secret is set, return 503.
- **Process each event once.** In **one transaction**, `INSERT INTO webhook_events (id, provider:'stripe', eventType) ON CONFLICT DO NOTHING`. If no row was inserted, return 200 with `{ duplicate: true }`. Otherwise dispatch, and return 200 once the transaction commits. If dispatch throws, roll back and return 500, so Stripe retries.
- **Dispatch by event type:**
  - **`checkout.session.completed`** with `payment_status === "paid"`, or **`checkout.session.async_payment_succeeded`:**
    - Load the registration from metadata, locking it `FOR UPDATE`.
    - **Validate all of these:** `client_reference_id` matches; `event.account ?? null` equals the registration's `stripeAccountId` snapshot; `amount_total === feeCents`; `currency === "usd"`; the registration is still live.
    - Then set `paymentStatus = paid`, `paymentMethod = stripe`, `amountPaidCents`, `paidAt`, `stripePaymentIntentId = session.payment_intent`.
    - Insert a ledger `charge` row (`stripeObjectId = payment_intent`, `applicationFeeCents`, `stripeAccountId`) and audit `payment.succeeded` (actor null).
    - If the registration was **cancelled** in the meantime, still record the charge in the ledger, mark the payment `paid`, and email program admins that a refund is needed.
    - **Never auto-refund.**
  - **`checkout.session.async_payment_failed`:** leave the registration `unpaid`, clear the session id, and audit `payment.failed`.
  - **`checkout.session.expired`:** clear `stripeCheckoutSessionId` if it matches.
  - **`charge.refunded`:** call `handleChargeRefunded(tx, charge, event.account ?? null)`.
  - **`charge.dispute.created`:** call `handleDisputeEvent(tx, dispute, acct, "opened")`.
  - **`charge.dispute.closed`:** call `handleDisputeEvent(tx, dispute, acct, "closed")`.
  - **`account.updated`:** call `handleAccountUpdated(account)`.
  - **Anything else:** record it and return 200.
- **Log carefully.** Never log card data or full payloads; log event id and type only.

**Nuntly webhook** (`POST /api/webhooks/nuntly`):
- **Verify the signature** with `NUNTLY_WEBHOOK_SECRET`. Check the installed `@nuntly/sdk` and Nuntly docs in `node_modules` for the signature scheme. If none is documented, use an HMAC-SHA256 header and report what you implemented.
- Return 503 when the secret is unset.
- **Process each event once** via `webhook_events` (provider `nuntly`).
- **On a bounced or complained event** for a recipient: set `users.emailBounced = true` for that email (case-insensitive) and audit `user.email_bounced`.
- **On a delivered event,** do nothing. Bounce status is cleared only by an admin, so this is a no-op.

**UI:**
- **Pay now button:** shown on the registration confirmation step, on `/registrations` rows (`unpaid` + `canPayOnline`), and on dashboard dues. When the route isn't ready, keep the existing "pay by cash or check" text.
- **Checkout states:** `/registrations?checkout=success` shows a processing state and then Paid; `?checkout=cancelled` shows a gentle note.

### PC: Refunds, disputes, ledger and reconciliation
**Owns:**
- `src/lib/dal/stripe-refunds.ts`: replace the stubs and keep the signatures.
- `src/lib/dal/payments-ledger.ts`.
- `src/app/(portal)/programs/[slug]/payments/ledger/**`: page and `export/route.ts` (CSV).
- `src/app/(admin)/admin/payments/**`: a board-wide ledger with a program filter.
- `src/components/payments-ledger/**`.
- Edits to `src/lib/dal/rosters.ts` and `src/components/rosters/**`: the Refund action, plus ledger rows for offline record and void.
- `src/lib/email.ts`: add functions only.

**Refund** (`refundRegistration(ctx, registrationId, { amountCents?, reason })`):
- **Who can call it:** program admin or board, and only for a Stripe-paid registration.
- **Amount:** the amount, defaulting to the remaining balance, must be greater than 0 and no more than `amountPaidCents - refundedCents`.
- **Call Stripe:** `refunds.create({ payment_intent, amount, reason: "requested_by_customer", refund_application_fee: true, metadata: { registrationId, requestedBy } }, { ...stripeRequestOptions(registration.stripeAccountId), idempotencyKey })`.
- **Audit and confirm:** audit `payment.refund_requested`. **Don't** write the ledger here: the `charge.refunded` webhook is the single source of truth, and refunds the league issues from its own Stripe dashboard are captured the same way. The UI says "Refund submitted, it will appear once Stripe confirms."

**`handleChargeRefunded(tx, charge, acct)`:**
- **Find the registration** by `charge.payment_intent`, falling back to metadata. Verify the account snapshot matches.
- **Write the ledger:** for each refund in `charge.refunds.data`, insert a ledger `refund` row keyed by `re_…`, using `ON CONFLICT (stripe_object_id) DO NOTHING`.
- **Update the registration:** set `registrations.refundedCents = charge.amount_refunded`. Set `paymentStatus = "refunded"` when `amount_refunded >= amountPaidCents`; a partial refund stays `paid`.
- **Audit** `payment.refunded`.

**`handleDisputeEvent`:**
- **On open:** insert a `dispute_opened` ledger row keyed by `dp_…` (an `opened`/`closed` suffix is fine to keep the keys unique), set `disputedAt`, email program admins (escaped; links to the ledger), and audit.
- **On close:** insert `dispute_closed` with the outcome in the note.

**Offline payments into the ledger:**
- `recordOfflinePayment` inserts `offline_payment` (method, amount, note), and `voidOfflinePayment` inserts `offline_void`.
- Both happen in the same transaction as the existing updates.

**Ledger and reconciliation:**
- `listLedger(ctx, { programId | all, from, to, kind?, cursor })`: keyset pagination, board or program admin.
- Totals for the range: gross charges, refunds, net, platform fees and disputes.
- CSV export via `src/lib/csv.ts`: one row per event, with LA dates, athlete, season, kind, method, amount, fee and the Stripe ids. Audit `roster.exported` with `kind: "payments_ledger"`.

**Roster UI:**
- For Stripe-paid rows, show **Refund** (a modal with amount and reason; partial allowed), a Disputed badge, and a refunded amount.
- Void stays offline-only.

## 2. Shared rules
- **Ownership:** touch only the files you own. Never edit the schema, migrations, `src/lib/stripe.ts`, `audit.ts`, `permissions.ts`, `context.ts`, nav files or `middleware.ts`. Report anything you need there.
- **Builds:** use `NEXT_DIST_DIR=.next-<ws>`. Run `git checkout tsconfig.json` afterwards. Leave no processes running.
- **Database:**
  - Create your own `gbys_<ws>` on localhost:5432 (postgres/postgres; `pg_ctlcluster 16 main start` if it's down).
  - Set it up with `DATABASE_URL=... npm run db:migrate:prod && npm run db:seed`.
  - Insert SQL fixtures using real UUIDs.
  - Never write `.env`. Drop the database when you're done.
- **Verification:**
  - Run `npx tsc --noEmit` and `next build`.
  - Write a DAL/route test with a **fake Stripe client** and **signed webhook payloads**.
  - Cover these races:
    - duplicate webhook delivery, including a concurrent duplicate, produces exactly one ledger row;
    - concurrent `startOnboarding` produces one account.
  - Do a Playwright pass with the magic-link dev login, intercepting the redirect to `checkout.stripe.com`.
  - Check 390px widths.
  - Keep scripts in the scratchpad.
- **Git:** don't commit or push. Report concisely.
