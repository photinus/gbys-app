# Finance 2 Plan: payables, reimbursements, receivables, donations & receipts, budgets

Builds on Finance 1. **Read `docs/FINANCE1_PLAN.md` first.** Its accounting rules, house conventions,
access model and testing notes all still apply. Phase A runs three parallel workstreams. Phase B then
does integration (bank-inbox shortcuts, overview tiles) and QA.

## User decisions (carried over)
- **Approvals:** separation of duties, plus dual approval above `fin_settings.dualApprovalThresholdCents`.
  - The approver can never be the bill's creator, its submitter, or the reimbursement payee.
  - At or above the threshold, two different approvers are needed.
  - Approvers are org-wide finance editors and admins (`canApproveBills`).
- **Donations:** track who has been sent receipts, and support restricted funds for program donations.
- **Access:** finance roles are read/write, read-only, or program-specific.
  - Program editors may submit bills for their own program and read that program's bills.
  - Every signed-in user can submit their own reimbursement claims.

## 0. Done by the orchestrator (read it, don't redo it)

### Schema: `src/db/schema/finance.ts` (Finance 2 section) and migration `0015`
- **`fin_contacts`:** vendors, customers and donors in one table. Role flags are `isVendor`, `isCustomer`
  and `isDonor`. Optional `userId` link (unique). 1099 fields:
  - `is1099`
  - `taxIdType`
  - `taxIdCiphertext`, which is encrypted
  - `taxIdLast4`
  - `w9ReceivedOn`

  It also has `defaultAccountId`.
- **`fin_bills`**, with `kind` = `bill` | `reimbursement`, and **`fin_bill_lines`** (account, fund (null =
  General), program, amount > 0).
  - Statuses: `draft`, `pending_approval`, `approved`, `partially_paid`, `paid`, `rejected`, `void`.
  - `approvalsRequired` (1 or 2) is snapshotted at submit.
  - `paidCents` is maintained by the DAL.
  - `journalEntryId` is set by the final approval.
- **`fin_bill_approvals`:** insert-only (trigger). Unique on `(billId, submittedAt, userId)`, so each
  submission round gets fresh decisions.
- **`fin_invoices`** and **`fin_invoice_lines`:** the number comes from `nextval('fin_invoice_number_seq')`,
  which starts at 1001. Statuses: `draft`, `open`, `partially_paid`, `paid`, `void`.
- **`fin_payments`** (`direction` out | in) and **`fin_payment_applications`:** each application settles
  exactly one bill or one invoice, and one payment can settle several.
- **`fin_gifts`:**
  - Fields: donor (nullable = anonymous cash), `kind` (`cash`, `check`, `card`, `ach`, `stripe`,
    `in_kind`, `other`), fund (required), program, revenue account, deposit account (null for in-kind),
    and the in-kind debit account and description.
  - Quid-pro-quo fields: `goodsServicesCents` and `goodsServicesDescription`.
  - Also `campaign`, `reference`, `isAnonymous`, the void columns and `journalEntryId`.
  - CHECK constraints tie in-kind to "no deposit account, and has a debit account".
- **`fin_receipts`:** an insert-only log of acknowledgments sent.
  - `kind`: `gift` (giftId) or `annual` (taxYear).
  - Snapshots: `amountCents` and `deductibleCents`.
  - Also `method` (email | print | mail), `sentTo`, `sentBy` and `sentAt`.
- **`fin_budgets`:** status draft | adopted, with fiscal-year start and end dates.
- **`fin_budget_lines`:** `monthlyCents integer[12]`. Index 0 is the fiscal year's first month, and both
  revenue and expense amounts are positive. Unique on `(budget, account, program)`.
- **`fin_attachments`:** owner `bill` | `invoice` | `gift` | `contact_w9`, private bucket, soft delete.
- **`fin_settings`** has new fields: `receiptSignerName`, `receiptSignerTitle`, `receiptMessage` and
  `invoicePaymentInstructions`.

### Code
- **`src/lib/dal/finance-contacts.ts`:**
  - `listContacts(ctx, {role, q})`. Program editors see vendors only.
  - `getContact` (`view_all`).
  - `createContact(ctx, input, tx?)`. Program editors may create vendors only, with no 1099 flag.
  - `updateContact` (`edit`).
  - `setContactTaxInfo` (`edit`; encrypted, last 4 kept).
  - `revealTaxId` (`admin`; audited).
  - `ensureContactForUser(tx, userId, role)`, a system helper.
  - `contactNames(ids)`.
  - Validation is in `src/lib/validation/finance-contacts.ts`.
- **`src/lib/dal/finance-attachments.ts`:** `storeAttachment(tx, {ownerType, ownerId, file, userId})`
  takes a `File` from server-action FormData (PDF/PNG/JPEG/WebP/HEIC, 10 MB or less; server actions
  allow 10 MB). Also `listAttachments`, `getAttachment`, `readAttachmentBytes` and
  `softDeleteAttachment`. **These don't authorize.** Each module checks access to the owner record and
  serves downloads from its own route handler.
- **`src/lib/dal/finance-bank-link.ts`:** `lockBankTxnForPosting(tx, id)` and `linkBankTxn(tx, …)`. Use
  them to record a payment or gift directly from a bank-feed transaction; the recipe is in the file
  header. Every money-moving create function takes an optional `bankTxnId`, and its new/record page
  accepts `?bankTxn=<id>` to prefill the account, date, amount and payee (Phase B links the inbox to it).
- **`src/lib/dal/finance-access.ts`:** `canApproveBills`, `canSubmitBillFor(a, programId)` and
  `canViewBillsFor(a, programId)`.
- **`src/lib/email.ts`:** `sendHtmlEmail({to, subject, html})`. Build templates in your own module and
  escape every value with `escapeHtml`.
- **Audit actions and targets:** `finance.contact_*`, `finance.tax_id_viewed`,
  `finance.attachment_added|removed`, `finance.bill_*`, `finance.reimbursement_submitted`,
  `finance.payment_recorded|voided`, `finance.invoice_*`, `finance.gift_*`, `finance.receipt_sent`,
  `finance.fund_released` and `finance.budget_*`.
- **Nav, Finance group:**

  | Entry | Path | Who sees it |
  |---|---|---|
  | Bills & payables | `/finance/payables` | everyone with finance access |
  | Invoices | `/finance/receivables` | org-wide |
  | Donations | `/finance/donations` | org-wide |
  | Budgets | `/finance/budgets` | everyone with finance access |

  The Volunteer group adds **Reimbursements** (`/reimbursements`) for everyone. Middleware protects
  `/reimbursements`.
- **Report index cards** link to `/finance/reports/budget`, `/ap-aging`, `/ar-aging`, `/donors` and
  `/1099`. Each workstream builds its own report pages.

### Posting rules (always `postEntry` / `voidEntry` inside a transaction)

| Event | Debit | Credit | source / sourceRef |
|---|---|---|---|
| Bill final approval | each line account (fund, program) | `accounts_payable` (2000) | `bill` / bill id |
| Reimbursement final approval | each line account | `reimbursements_payable` (2010) | `reimbursement` / bill id |
| Payment out | 2000 or 2010 (one line per application) | payment account (bank / petty cash) | `bill_payment` / payment id |
| Invoice issued | `accounts_receivable` (1200) | each line revenue account (fund, program) | `invoice` / invoice id |
| Payment in | payment account (bank or `undeposited_funds`) | 1200 (per application) | `invoice_payment` / payment id |
| Gift (money) | deposit account | revenue account (fund, program) | `donation` / gift id |
| Gift (in-kind) | in-kind debit account (default `in_kind_expense` 6100, or an asset) | `in_kind_contributions` (4070) | `donation` / gift id |
| Fund release | `net_assets_restricted` (3100) in the restricted fund | `net_assets_unrestricted` (3000) in the General Fund | `fund_release` / uuid |

- **Dates:** the bill date, issue date, payment date and gift date are entry dates. A final approval that
  lands in a closed period posts on lockDate + 1, with "(dated <date>)" in the memo. Every other create
  in a closed period is **refused** with the friendly `assertPeriodOpen` error, and the user picks a
  later date.
- **Voids:**
  - Voiding a payment voids its entry and recomputes `paidCents` and status on its bills or invoices.
  - A bill or invoice with live payments can't be voided.
  - Voiding an approved bill voids its entry.
  - Gifts void their entry. A gift that already has a receipt can still be voided; show a warning that a
    receipt was sent.
- **Status from `paidCents`:** 0 means approved (bills) or open (invoices); between 0 and the total means
  `partially_paid`; equal to the total means `paid`. Over-application is refused.

## 1. Phase A workstreams (parallel; no file overlap)

### PB: Payables, reimbursements, contacts UI, A/P reports
**Owns:**
- `src/lib/dal/finance-bills.ts`, `finance-payments-out.ts`, `finance-payables-reports.ts`
- `src/lib/validation/finance-bills.ts`
- `src/lib/finance/approvals.ts` (pure; unit-test it)
- `src/components/finance/payables/**` and `src/components/finance/contacts/**`
- Pages under `/finance/payables/**`, `/finance/contacts/**`, `/reimbursements/**` (in `(portal)`),
  `/finance/reports/ap-aging/**` and `/finance/reports/1099/**`
- Email templates in `src/lib/finance/payables-email.ts`

**Contacts UI (`/finance/contacts`):**
- List with role filter and search; detail and edit for every role.
- Tax info form: SSN/EIN plus the date the W-9 was received.
- W-9 upload (attachment `contact_w9`) and download.
- "Reveal" for admins, shown in a modal and audited.
- Links to the contact's bills, invoices and gifts. Other modules link here.

**Bills (`edit`, or a program editor for their own program):**
- Create and edit a draft: vendor (pick, or create inline as a vendor), vendor invoice #, bill date, due
  date (default from bill date + 30), memo, and lines (account defaults to the vendor's default account;
  fund; program), plus attachments.
- Program editors: the header program and every line program must be theirs.

**Approval flow:**
1. **Submit:** sets `pending_approval` and `submittedAt`, and snapshots `approvalsRequired` from the
   threshold. Notifies approvers by email.
2. **Approve or reject**, with a note:
   - Refused when the approver is the creator, submitter or payee.
   - Refused when the approver already decided this round.
   - A rejection needs a reason, moves the bill to `rejected`, and lets the creator edit and resubmit.
3. **Final approval** posts the entry.
- Show an approvals panel listing who approved and when.
- Approval queue page: "Waiting for my approval".

**Reimbursements:**
- `/reimbursements` (any signed-in user): my claims, plus "New claim".
  - Each claim has a date, a description and amount per line (no account picker), an optional program
    from programs the user is involved in or all active programs, and receipt photos (at least one
    required).
  - Creates `kind = reimbursement` with the contact from `ensureContactForUser(…, "vendor")` and
    `payeeUserId` = the user. It is created as `pending_approval` straight away; line accounts are left
    for finance to set.
  - **Contract gap:** `fin_bill_lines.accountId` is NOT NULL, so use account `6900` Miscellaneous by
    default; finance re-categorizes during review.
  - Claimants see status, approvals and payment, and can withdraw (void) while pending.
- On the finance side, reimbursements appear in payables, where reviewers can edit the lines while
  pending (re-categorizing is not a resubmit).
- The claimant is emailed on approval, rejection and payment.

**Payments out:**
- Pay one bill or select several open bills for the same contact.
- Fields: amount per bill (default the balance), date, method, check # or reference, and a "from"
  account (isBank accounts, active only).
- Supports `?bankTxn=` and `bankTxnId`. Void payment with a reason.
- "Print check details" view: payee name and address, amount in words, memo. This is not check printing.

**Reports:**
- **A/P aging** (`view_all`): open bills by due-date bucket (current, 1–30, 31–60, 61–90, 90+), as of a
  date, with a CSV.
- **1099 vendors** (`view_all`): calendar-year payments to contacts with `is1099`, excluding `card` and
  `stripe` methods (card processors file 1099-K). Flag totals of $600 or more, show W-9 on file yes/no
  and TIN last 4, with a CSV that includes the full TIN only for admins (audited via `revealTaxId`).

### RB: Receivables (invoices) and budgets
**Owns:**
- `src/lib/dal/finance-invoices.ts`, `finance-payments-in.ts`, `finance-budgets.ts`
- `src/lib/validation/finance-invoices.ts` and `finance-budgets.ts`
- `src/lib/finance/invoice-email.ts` and `src/lib/finance/budget-math.ts` (pure; unit-tested)
- `src/components/finance/receivables/**` and `src/components/finance/budgets/**`
- Pages under `/finance/receivables/**`, `/finance/budgets/**`, `/finance/reports/ar-aging/**` and
  `/finance/reports/budget/**`

**Invoices (`edit`):**
- Draft: customer (pick, or create inline as a customer), issue date, due date (+30 default), memo, and
  lines (description, revenue account, fund, program, amount), plus attachments.
- **Issue** posts the entry and sets the status to `open`.
- **Send** emails an HTML invoice: org name, logo URL, number, dates, lines, total, balance due and
  `invoicePaymentInstructions`. Records `sentAt`/`sentToEmail` and can be re-sent.
- Printable page `/finance/receivables/[id]/print` (print CSS).
- Void needs a reason. List filters: status, overdue, customer.

**Payments in:**
- Receive against one or more open invoices for one customer.
- Deposit account: isBank or `undeposited_funds` (the default for checks).
- Supports `?bankTxn=` and `bankTxnId`. Void.

**A/R aging** (`view_all`): same buckets and CSV as A/P aging.

**Budgets:**
- **Who can do what:** `edit` creates and edits, `admin` adopts, and `any` reads (program users see only
  their program's lines).
- **Creating one:** for a fiscal year (from `fiscalYearOf` with the settings start month), either blank,
  copied from another budget, or seeded from the prior fiscal year's actuals (by account and program,
  rounded to dollars).
- **Grid editor:** rows are revenue and expense accounts (optionally per program); columns are 12 months
  with an annual total. "Spread annual evenly" puts the remainder cents in the last month. Totals show
  for revenue, expense and net. Mobile-usable: one row at a time, or horizontal scroll inside the grid
  wrapper.
- **Adopted budgets:** adopting one (admin; audited) makes it read-only unless an admin un-adopts it with
  a reason. At most one adopted budget per fiscal year.
- **Budget vs. actual report** (`any`, filtered for program users):
  - Pick the budget and a period (month, YTD or full year).
  - Actuals come from `sumLines` for the same months.
  - Per account and program: budget, actual, variance $ and %. Expense overages are red and revenue
    shortfalls amber.
  - Totals for revenue, expense and net, with a CSV.

### DN: Donations, receipts, fund releases
**Owns:**
- `src/lib/dal/finance-donations.ts` and `finance-receipts.ts`
- `src/lib/validation/finance-donations.ts`
- `src/lib/finance/receipt-content.ts` (pure; unit-tested) and `receipt-email.ts`
- `src/components/finance/donations/**`
- Pages under `/finance/donations/**` and `/finance/reports/donors/**`
- **Edits to Finance 1 files:**
  - The settings page (`src/app/(portal)/finance/settings/**`,
    `src/components/finance/gl/settings-forms.tsx`, `src/lib/dal/finance-settings.ts`,
    `src/lib/validation/finance-gl.ts`): add the four new `fin_settings` fields (receipt signer
    name/title, receipt message, invoice payment instructions).
  - The reports (`src/lib/finance/report-math.ts`, `src/lib/dal/finance-reports.ts` and their tests):
    explicit `fund_release` entries must appear as "Net assets released from restrictions" in the
    Statement of Activities (moved from the restricted to the unrestricted column), and count in the
    Fund balances releases column. Keep the "release on spend" computation. Keep changes minimal and
    re-run FD's tests (`scratchpad/fd/`).

**Gifts (`edit`):**
- Record a gift:
  - Donor: pick, create inline (individual or organization, email and address for receipts), or
    anonymous.
  - Date, amount, kind, and reference (check #).
  - Fund: General or a restricted fund, with the program defaulting from the fund's program.
  - Revenue account, defaulting to `contributions`. Restrict the choices to revenue accounts with subtype
    Contributions, Grants or Fundraising events, plus any other revenue account behind an "other"
    option.
  - Deposit account: defaults to `undeposited_funds` for cash and check, else the Stripe payout bank.
  - In-kind fields: description, fair value as the amount, and the debit account.
  - Quid-pro-quo fields, campaign, anonymous flag, and note.
- Supports `?bankTxn=` and `bankTxnId` (money gifts only). Edit (= void and re-record, keeping the receipt
  log), void, and attachments (e.g. a check image).
- Lists: gifts with filters (date range, fund, campaign, donor, receipt status).

**Donors:**
- Donor list: lifetime total, this year's total, last gift date, and email/address present.
- Donor page: giving history and receipts sent. Edit goes to `/finance/contacts/[id]`.

**Receipts** (written acknowledgment per IRS Pub. 1771):
- Content:
  - The org's legal name, `legalDesignation` and EIN (from `org_settings`), and the donor name and address.
  - Date and amount for cash gifts. For in-kind: a description, **not a value**.
  - Quid-pro-quo statement: either "No goods or services were provided in exchange for this
    contribution", or a description and good-faith estimate with the deductible amount
    (amount − goods/services).
  - For payments over $75 with quid-pro-quo, include the required disclosure sentence.
  - Signer name and title, plus `receiptMessage`.
- Per gift: send by email (donor email required; records `fin_receipts`), or "Print / mark as mailed".
- Bulk "Send receipts for all unacknowledged gifts" (with email) in a date range, showing a preview
  count first.
- Annual statements for a calendar year: one receipt listing all of a donor's gifts that year. Bulk email,
  plus a printable batch page with page breaks.
- Receipt status everywhere: Not sent / Emailed <date> / Printed <date>. Gifts under $250 are still
  receipted, since that's the org's choice, but flagged "Required" when $250 or more.
- Anonymous gifts with no donor can't be receipted.

**Fund releases (`edit`):**
- On a restricted fund (from the donations area, with a "Funds" tab showing restricted fund balances),
  "Release funds": amount up to the balance, date and reason. Posts the release entry and audits
  `finance.fund_released`.
- Show the release history.

**Donor report** (`view_all`): gifts by donor for a period, with totals, deductible totals, receipt
status counts and a CSV. Anonymous gifts are grouped.

## 2. Phase B (after A): integration and QA
- In the bank inbox, add "Pay bills", "Receive invoice payment" and "Record donation" shortcuts on New
  transactions (money out → bills; money in → invoices/donations). Each links to the module form with
  `?bankTxn=`.
- Finance overview tiles: bills awaiting my approval, bills due in 14 days, A/R outstanding, gifts needing
  receipts.
- Make sure the Finance 1 auto-match still works.
- End-to-end QA on a production build.

## 3. Testing
Same as Finance 1 §2:
- Fresh DB per worker, DAL tests with the `server-only` stub, and `next build` + `next start` with a
  Playwright smoke test (magic links come from the "[EMAIL not sent" HTML in the server log; about 5
  magic links per minute).
- Check for horizontal overflow at 390px.
- Run `git checkout tsconfig.json` after each build (next build rewrites it).
- Ports and dist dirs: PB 3221 `.next-pb`, RB 3222 `.next-rb`, DN 3223 `.next-dn`. Uploads need a fake S3
  (a tiny local HTTP server that stores PUT bodies; set `S3_ENDPOINT`, `S3_BUCKET` and keys), or test
  attachment DAL calls with a stubbed `putPrivateObject`.
- **Gate:** `npx tsc --noEmit` is clean and your build succeeds. Do not commit; the orchestrator
  integrates.
