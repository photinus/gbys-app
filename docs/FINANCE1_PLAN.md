# Finance 1 Plan: double-entry ledger, SimpleFIN bank feed, Stripe auto-post, reports

This plan binds the parallel workers for the first half of the board accounting module.
Finance 2 (payables, receivables, donations & receipts, budgets) builds on it later.
`AGENT_HANDOFF.md` invariants still apply; **invariant 4 (all DB access through the DAL)** and
**9 (LA time)** matter most.

House conventions (unchanged):
- DAL functions take `ctx` first and authorize inside (system actors — cron, webhook — are the
  allowed exception). Actions: zod → `runAction` → `revalidatePath` → `ActionResult`.
- Forms use `useActionForm` (`src/components/household/use-action-form.ts`).
- UI uses only `src/components/ui/*` primitives (plus lucide icons). No new npm dependencies.
- No horizontal overflow at 390px. Money tables scroll inside their own `overflow-x-auto` wrapper.
- Every write is audited with `writeAudit` (finance actions/targets already added to `src/lib/audit.ts`).

## User decisions
- **Bookkeeping model:** real double-entry, but the UI speaks plain language
  ("money in / money out", "category", "fund", "program").
- **Stripe:** auto-post GBYS-run registration revenue and Stripe fees; partner-league direct
  charges are NOT GBYS money (excluded) — only the platform fee GBYS earns on them is revenue.
  Stripe payouts are posted and matched to the bank deposit automatically.
- **Approvals:** separation of duties + dual approval above a threshold (Finance 2 bills; the
  threshold setting exists now).
- **2FA:** not now.

## Accounting rules (read before coding)
- **Amounts** are integer cents. **Accounting dates** are `date` columns = LA calendar day, handled as
  `"YYYY-MM-DD"` strings (`src/lib/finance/dates.ts`: `laToday`, `laDateOf`, `isIsoDate`, `addDays`,
  `endOfMonth`, `fiscalYearOf`). Compare as strings. Never `new Date("2026-11-01")` (that is UTC).
- **Natural balance:** asset & expense = debits − credits; liability, net assets & revenue =
  credits − debits (`naturalBalance`, `isDebitNormal` in `finance-ledger.ts`).
- **Funds:** every line has a fund (default General Fund, `without_donor_restrictions`). Restricted
  funds have `restriction = with_donor_restrictions`, optional `programId`.
- **Program class:** `programId` on a line = that program's activity; null = organization-wide
  (management & general).
- **Restricted-fund presentation ("release on spend"):** revenue lines tagged to a restricted fund are
  "with donor restrictions" revenue. Expense lines tagged to a restricted fund are presented as
  expenses *without* donor restrictions plus an equal "Net assets released from restrictions"
  reclassification (− in the restricted column, + in the unrestricted column). No release entries are
  posted for this; reports compute it. Restricted fund balance = its revenue − its expenses
  (+ any opening balance lines on `net_assets_restricted`). A fund that would go negative is flagged.
- **Net assets on the balance sheet:** without restrictions = `3000` balance + cumulative
  (revenue − expense − releases) for unrestricted funds; with restrictions = `3100` balance +
  cumulative restricted fund balances. Statement of financial position must balance
  (assets = liabilities + net assets); show a red warning if it doesn't.
- **Functional expenses (Form 990 style):** expense lines with a `programId` = Program services;
  expense accounts with subtype `Fundraising` = Fundraising; everything else = Management & general.
- **Immutability:** lines are insert-only; an "edit" is `replaceEntry` (void + re-post, linked). DB
  triggers refuse anything else, refuse posting/voiding on or before `fin_settings.lock_date`, and
  refuse unbalanced entries at COMMIT. Voided entries are excluded from every report, shown greyed in
  the journal.

## 0. Done by the orchestrator (read it, don't redo it)

### Schema — `src/db/schema/finance.ts`, migration `drizzle/0014_finance_ledger.sql`
- `fin_accounts` (chart of accounts; `code` unique, `type`, `subtype` report group, `systemKey`,
  `isBank`, `is1099`, `isActive`). **Seeded** with a 50-account UCOA-style nonprofit chart. System
  keys (`FinSystemAccountKey`): `checking` 1000, `stripe_clearing` 1050, `undeposited_funds` 1060,
  `accounts_receivable` 1200, `pledges_receivable` 1210, `accounts_payable` 2000,
  `reimbursements_payable` 2010, `deferred_revenue` 2200, `net_assets_unrestricted` 3000,
  `net_assets_restricted` 3100, `contributions` 4010, `in_kind_contributions` 4070,
  `registration_revenue` 4200, `platform_fee_revenue` 4300, `payment_processing_fees` 6010,
  `in_kind_expense` 6100. System accounts can be renamed but never deactivated or re-typed.
- `fin_funds` (General Fund seeded, `systemKey = "general"`).
- `fin_settings` singleton (seeded): `fiscalYearStartMonth`, `lockDate`, `stripePayoutAccountId`,
  `autoPostStartDate`, `dualApprovalThresholdCents`.
- `fin_period_closes` (insert-only history of lock-date changes).
- `fin_roles` (finance access grants; see access below).
- `fin_journal_entries` (`entryNumber` bigserial, `entryDate`, `memo`, `source`, `sourceRef`
  unique per live source, void columns, `replacedByEntryId`) and `fin_journal_lines`
  (`accountId`, `fundId`, `programId`, `debitCents`/`creditCents` exactly one > 0, `description`).
- Banking: `fin_simplefin_connections` (encrypted access URL), `fin_bank_accounts` (feed account →
  `glAccountId` unique, `importStartDate`, balances), `fin_bank_transactions` (unique
  `(bankAccountId, externalId)`, signed `amountCents`, `status` new|posted|excluded,
  `journalEntryId` set iff posted — CHECK constraint), `fin_bank_rules`, `fin_reconciliations`
  (one in-progress per GL account), `fin_cleared_lines` (a line clears once).
- `fin_stripe_payouts` (po_ id, amount, fees, arrival date, journal entry).

### Code
- `src/lib/crypto.ts`: `encryptSecret` / `decryptSecret` (AES-256-GCM, `FINANCE_ENCRYPTION_KEY`),
  `isEncryptionConfigured()`, `EncryptionUnavailableError`.
- `src/lib/finance/dates.ts` (above).
- `src/lib/dal/finance-access.ts`: `getFinanceAccess(ctx)` → `{ level: admin|editor|viewer|null,
  programs: [{programId, role}] }`; `requireFinance(ctx, "any"|"view_all"|"edit"|"admin")`;
  `canEditBooks`, `isFinanceAdmin`, `canViewAllFinance`, `viewableProgramIds` ("all" | ids),
  `canViewProgramFinance`, `canEditProgramFinance`. super_admin = implicit admin, board_member =
  implicit org-wide viewer.
- `src/lib/dal/finance-ledger.ts` — **the only writer of journal rows**:
  `postEntry(tx, input)` (validates balance/accounts/funds/lock date; idempotent on
  `(source, sourceRef)` — returns `{entryId, entryNumber, created}`), `voidEntry(tx, …)`
  (refuses completed-reconciliation lines; resets linked bank txns to `new` and Stripe payouts),
  `replaceEntry(tx, …)` (void + re-post + relink bank txns), `assertPeriodOpen`, `getLockDate`,
  `systemAccountId(tx, key)`, `generalFundId(tx)`, `sumLines(tx, filter)` (non-voided totals grouped
  by account/fund/program with date, program, fund and account filters), `naturalBalance`.
- `src/lib/dal/shell-user.ts` (`buildShellUser(ctx)` — layouts use it) and the **Finance** nav
  group (`src/components/shell/nav.ts`): Finance overview `/finance`, Banking `/finance/banking`,
  Journal `/finance/journal`, Reports `/finance/reports`, Accounts & funds `/finance/accounts`,
  Finance settings `/finance/settings` (admin only). Program-scoped users see Overview + Reports only.
- `src/app/(portal)/finance/layout.tsx`: 404 for users without any finance access. Pages still
  authorize through the DAL (`requireFinance`) and `notFound()` on FORBIDDEN.
- Middleware protects `/finance/*`.
- Contract stubs (replace the bodies, keep signatures): `src/lib/dal/finance-autopost.ts`
  (`postPaymentEventSafely`, `postPendingPayments`, `handlePayoutEvent`) and
  `src/lib/dal/finance-banking.ts` (`syncAllConnections`).
- `src/app/api/cron/finance-sync/route.ts` (CRON_SECRET bearer): runs `postPendingPayments()` then
  `syncAllConnections()`.
- `.env.example`: `FINANCE_ENCRYPTION_KEY`.

## 1. Workstreams (parallel; no file overlap)

Every page lives under `src/app/(portal)/finance/…`. Page header pattern: `h1` "text-2xl font-bold
tracking-tight sm:text-3xl" + `text-sm text-stone-500` subtitle (see `/admin/payments/page.tsx`).
Reuse `formatCents` for display and `dollarsToCents` (`src/lib/validation/rosters.ts`) for input.

### FA — Ledger core: overview, chart of accounts & funds, journal, settings & access
**Owns:** `src/lib/dal/finance-accounts.ts`, `finance-journal.ts`, `finance-settings.ts`,
`finance-overview.ts`, `src/lib/validation/finance-gl.ts`, `src/components/finance/gl/**`, pages
`/finance` (page.tsx only — not layout), `/finance/journal/**`, `/finance/accounts/**`,
`/finance/settings/**`.

- **Accounts & funds** (`view_all` to read; `edit` to write): list grouped by type with code, name,
  subtype, current balance (`sumLines`), active toggle, 1099 flag, bank flag. Create/edit account
  (code unique 3–10 chars digits/dots/dashes, type immutable once lines exist, system accounts can't
  be deactivated/retyped). Funds tab: create/edit (name, code, restriction, program, purpose,
  active); restriction is immutable once the fund has lines; General Fund can't be deactivated.
  Balance per fund. Audit `finance.account_*`, `finance.fund_*`.
- **Journal** (`view_all`): paginated list (keyset on entryNumber desc) with date range, source,
  account and search-in-memo filters; voided greyed with reason. Detail page: lines with account /
  fund / program / description, links to the bank transaction or registration that created it, void
  history and "replaced by #N". **New entry** (`edit`): multi-line editor (account, fund, program,
  debit, credit, description; add/remove rows; live "out of balance by $X"); also an "Opening
  balances" helper preset (source `opening_balance`, offset to `3000`/`3100`). **Edit** = replaceEntry
  (reason required) for `manual`/`opening_balance` entries; other sources show "edit from its source"
  but **Void** (reason) is allowed for `edit`. Audit `finance.entry_posted|voided|replaced`.
  Expose a reusable `<LinesEditor>` in `src/components/finance/gl/lines-editor.tsx` and a server
  helper `getPostingOptions(ctx)` in `finance-accounts.ts` (active accounts grouped by type, active
  funds, programs). FB builds its own simpler categorize/split form and options loader (no cross-imports
  between workstreams while they run in parallel; the orchestrator may consolidate later).
- **Settings** (`admin`): fiscal-year start month; Stripe payout bank account (isBank accounts);
  auto-post start date (explain: registration payments on/after this date post automatically; leave
  blank to keep auto-post off); dual-approval threshold (dollars, optional; "used by bills in a later
  release"). **Close books through** date (must be ≥ current lock unless "Reopen" which needs a reason;
  writes `fin_period_closes` + audit `finance.period_closed|reopened`), with a list of past closes.
  **Access:** list implicit (super admins, board) and explicit grants; grant user (search active
  users by name/email) a role org-wide or for a program (program: editor/viewer only); revoke
  (sets revokedAt). Can't revoke your own admin grant if you'd lose admin (super admins are implicit
  anyway). Audit `finance.access_*`, `finance.settings_updated`.
- **Overview `/finance`** (`any`): org-wide users: cash & bank balances (each isBank account's GL
  balance + linked feed balance and "last synced"), Stripe balance account, undeposited funds, fund
  balances (restricted funds with program), this fiscal year's revenue vs expense, count of bank
  transactions needing review (link `/finance/banking`), books-closed-through date, setup checklist
  (encryption key configured, bank connected, payout account chosen, auto-post start date set). Program
  users: their programs' fiscal-YTD revenue/expense and restricted funds for their programs, link to
  Reports. Quick links.

### FB — Banking: SimpleFIN, bank inbox, rules, reconciliation
**Owns:** `src/lib/simplefin.ts`, `src/lib/dal/finance-banking.ts` (replace stub),
`finance-rules.ts`, `finance-reconcile.ts`, `src/lib/validation/finance-banking.ts`,
`src/components/finance/banking/**`, pages `/finance/banking/**`.

- **SimpleFIN client** (`src/lib/simplefin.ts`, pure + fetch; injectable fetch for tests):
  `claimSetupToken(token)` — token is base64 of a claim URL; POST to it (empty body) returns the
  access URL `https://user:pass@host/path`. Validate the decoded claim URL is https.
  `fetchAccounts(accessUrl, { startDate, endDate, pending=false })` — GET `{access}/accounts` with
  `start-date`/`end-date` unix seconds; **strip userinfo from the URL and send it as
  `Authorization: Basic`** (Node fetch rejects credentialed URLs); timeout 30s; parse tolerant of
  both protocol versions: `errors: string[]` or `errlist: [{code,msg}]`; accounts
  `{id, name, currency, balance, "available-balance", "balance-date", org: {name, domain}|conn_id,
  transactions: [{id, posted, amount, description, payee?, memo?, pending?}]}`; amounts are decimal
  strings → integer cents without float error. Windows: request at most **60 days** per call and
  loop. Never log the access URL.
- **Connect** (`admin`): paste setup token → claim → encrypt (`encryptSecret`) → store connection
  (label) → initial balances-only fetch to create `fin_bank_accounts`. If `FINANCE_ENCRYPTION_KEY` is
  missing, refuse with a clear message. Show connections with last sync status/messages; Disconnect
  (sets revokedAt, deactivates its accounts). Audit `finance.bank_connected|disconnected`.
- **Bank accounts** (`edit`): map each feed account to an `isBank` GL account (unique) and set an
  import start date (default: first day of current month). Unmapped accounts don't import. Audit.
- **Sync** — `syncAllConnections()` (system, cron) and `syncNow(ctx)` (`edit`, refuse if synced in
  the last 15 min — SimpleFIN Bridge allows ~24 requests/day): for each mapped account fetch from
  `max(importStartDate, lastSync − 14 days)` to today; insert new posted (non-pending) transactions
  `on conflict do nothing` on `(bankAccountId, externalId)`; `postedDate = laDateOf(posted*1000)`;
  skip before importStartDate; update balances; store errors on the connection. After insert run
  rules and **auto-match**. Audit one `finance.bank_synced` per run (counts only).
- **Auto-match:** for a new txn, candidates = live entries with a line on the txn's GL account whose
  signed amount equals the txn (deposit ↔ debit, withdrawal ↔ credit), entry date within ±5 days, not
  already linked to a txn in this bank account. Auto-link (status posted) only when exactly one
  candidate has source `stripe_payout` or `transfer`; otherwise show candidates as "Possible match"
  in the inbox.
- **Rules** (`edit`): CRUD + priority ordering; match description/payee contains/equals/starts with
  (case-insensitive), direction, amount bounds, optional bank account; result account (+fund,
  program, memo). `autoPost` rules post immediately on import (source `bank`, sourceRef = txn id),
  others set `suggestedRuleId`. "Create rule from this transaction" shortcut in the inbox.
- **Inbox `/finance/banking`** (`view_all` read, `edit` act): tabs New / Posted / Excluded, filter by
  account; each row: date, description/payee, amount (green in / red out), suggestion. Actions:
  **Categorize** (one category + fund + program + memo, or **split** into several lines summing to
  the amount) → `postEntry` source `bank`, sourceRef txn id: bank GL line + category lines;
  **Transfer** to another isBank account (source `transfer`); **Match** to a candidate entry;
  **Exclude** (reason: duplicate/personal/other) and Restore; **Undo** on posted rows (voids the
  entry if source `bank`/`transfer` and it was created from this txn, or just unlinks a match).
  Bulk categorize selected rows with the same category. All writes in one transaction with
  `select … for update` on the txn row; audit `finance.bank_txn_*`.
- **Reconcile** (`edit`): start for an isBank GL account: statement end date + ending balance;
  beginning balance = sum of previously cleared lines on that account. Page lists uncleared
  non-voided lines on that account dated ≤ statement end (and earlier uncleared), checkbox to clear,
  running "cleared balance" vs statement and difference; Complete only when difference = 0 (sets
  status completed). Discard an in-progress reconciliation. History list with completed reports.
  Audit `finance.reconciliation_*`.

### FC — Auto-posting: registrations, Stripe fees, payouts
**Owns:** `src/lib/dal/finance-autopost.ts` (replace stub), a page `/finance/stripe/**` (+
`src/components/finance/stripe/**`), and **minimal** edits to existing payment code to call the hooks:
`src/lib/dal/stripe-webhook.ts`, `src/lib/dal/stripe-refunds.ts`, `src/lib/dal/registrations.ts`
(offline payment / void), `src/app/api/webhooks/stripe/route.ts` (route `payout.*` events).

- **Which money is GBYS's:** a payment_event is postable when its program has
  `isIndependentPartner = false` **and** the event's `stripeAccountId` is null (platform) — or it is
  an offline payment/void for such a program. For partner programs only the application fee is
  posted (revenue `platform_fee_revenue`, program class = the partner program).
- **Mapping** (fund General, program class = event's program, entry date = `laDateOf(occurredAt)`,
  source `registration`, sourceRef = payment_event id; partner fee: source `platform_fee`, sourceRef =
  payment_event id):
  - `charge`: Dr `stripe_clearing` / Cr `registration_revenue`.
  - `refund`: Dr `registration_revenue` / Cr `stripe_clearing`.
  - `dispute_opened`: Dr `registration_revenue` / Cr `stripe_clearing` (funds withdrawn);
    `dispute_closed` **won**: the reverse (read how stripe-refunds records the outcome); lost: nothing.
  - `offline_payment` with method cash/check: Dr `undeposited_funds` / Cr `registration_revenue`;
    scholarship: no entry (skipped). `offline_void`: reverse of the payment it voids (look at how
    registrations.ts records it).
  - Partner `charge` with `applicationFeeCents > 0`: Dr `stripe_clearing` / Cr `platform_fee_revenue`.
- **Start date:** nothing posts while `fin_settings.autoPostStartDate` is null; events with
  occurredAt before it are skipped. **Closed period:** an event dated on/before the lock date posts on
  lockDate + 1 with "(originally <date>)" in the memo.
- `postPaymentEventSafely(tx, id)`: run inside a **savepoint** (`tx.transaction(...)`) and swallow +
  log errors, so a ledger problem never breaks a webhook or an offline payment. Call it right after
  every payment_events insert. `postPendingPayments()`: sweep all postable events without a live
  entry; one audit `finance.auto_posted` row per sweep with counts.
- **Payouts** (`handlePayoutEvent`, platform account events only — ignore events with `event.account`):
  upsert `fin_stripe_payouts`. On `payout.paid`: list balance transactions for the payout
  (`stripe.balanceTransactions.list({ payout, limit: 100 })`, auto-paginate), sum `fee` → entry
  source `stripe_fee` sourceRef po_id: Dr `payment_processing_fees` / Cr `stripe_clearing` (skip if 0);
  entry source `stripe_payout` sourceRef po_id: Dr payout bank account (`stripePayoutAccountId` or
  `checking`) / Cr `stripe_clearing`, date = LA arrival date. `payout.failed`/`canceled` after paid:
  void both entries (reason "Payout failed"). Stripe calls happen with the webhook's tx open — keep them
  few; if listing fails, still post the payout and record fees 0 + a flag to retry from the page.
- **`/finance/stripe`** (`view_all`; buttons `edit`): auto-post status (start date, last sweep),
  "Post pending payments now", counts of unposted/failed events with reasons, recent payouts table
  (amount, fees, arrival, entry links, matched bank txn yes/no), "Import recent payouts" (lists the
  last 30 days of payouts from Stripe and runs the same handler) — disabled when Stripe isn't
  configured.
- Tell the user (in your report) the Stripe webhook must also send `payout.paid`, `payout.failed`,
  `payout.canceled` on the platform endpoint.

### FD — Reports
**Owns:** `src/lib/dal/finance-reports.ts`, `src/lib/finance/report-math.ts` (pure functions,
unit-tested), `src/components/finance/reports/**`, pages and CSV route handlers under
`/finance/reports/**`.

- Report index cards. All reports: date controls default to the current fiscal year
  (`fiscalYearOf(laToday(), fiscalYearStartMonth)`), quick ranges (this FY, last FY, this month, last
  month, custom), **CSV export** (`src/lib/csv.ts`; audit `finance.report_exported`), print-friendly
  layout (`print:` classes hide the sidebar).
- **Statement of Activities** (`any`; program users see only their program lines and no balance sheet
  items): revenue and expense by account grouped by subtype, columns Without donor restrictions / With
  donor restrictions / Total, the "Net assets released from restrictions" line per the rules above,
  change in net assets. Filters: program, fund.
- **Statement of Financial Position** (`view_all`): as-of date; assets, liabilities, net assets
  (without / with restrictions computed per rules), balance check.
- **Trial balance** (`view_all`): as-of, every account with debit/credit balance columns; totals equal.
- **Account register / General ledger** (`view_all`; program users: only their program lines):
  pick an account → lines in date order with running balance, opening balance at range start, links to
  journal entries.
- **Fund balances** (`any`, program users: funds of their programs): per fund opening, revenue,
  expenses (released), closing; negative balances flagged.
- **Program summary** (`any`, filtered): revenue/expense/net per program class (+ "Organization-wide").
- **Functional expenses** (`view_all`): expense accounts × Program services / Management & general /
  Fundraising.
- **CPA export** (`view_all`): all non-voided journal lines in range as CSV (entry #, date, memo,
  source, account code, account name, fund, program, debit, credit, line description).
- Use `sumLines` for totals; write one register query yourself. Performance target: thousands of
  lines — single grouped queries, no N+1.

## 2. Testing reality
- Fresh DB per worker: `createdb` via `PGPASSWORD=postgres psql -h localhost -U postgres -c "create database gbys_<ws>"`,
  `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gbys_<ws> npm run db:migrate:prod && npm run db:seed`.
- DAL tests: `npx tsx` scripts in the scratchpad with `NODE_OPTIONS="--require <stub.cjs>"` where the stub maps
  `server-only` to `{}` (`const M=require("module");const o=M._load;M._load=function(r,...a){return r==="server-only"?{}:o.call(this,r,...a)}`).
  Build `SessionContext` objects directly (`{userId,email,name,image:null,orgRole,programRoles:[],teamStaff:[]}`).
- Browser checks: `NEXT_DIST_DIR=.next-<ws> npx next build` then `next start -p <port>` with
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:<port>`; sign in by POSTing
  `/api/auth/sign-in/magic-link` and reading the `[DEV MAGIC LINK]` URL from the server log; Playwright
  is `require('playwright')` / `/opt/node-tools/node_modules/playwright/index.mjs`. Check 390px overflow.
- The sandbox can't reach SimpleFIN or Stripe: FB injects a fake fetch / local fake SimpleFIN HTTP
  server; FC injects a fake Stripe client via `__setStripeForTests` (or a https preload stub).
- Ports / dist dirs: FA 3201 `.next-fa`, FB 3202 `.next-fb`, FC 3203 `.next-fc`, FD 3204 `.next-fd`.
- Gate before reporting: `npx tsc --noEmit` clean and your `next build` succeeds. Do **not** commit;
  the orchestrator integrates.
