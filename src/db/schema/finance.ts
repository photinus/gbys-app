import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  pgEnum,
  index,
  uniqueIndex,
  check,
  boolean,
  date,
  bigserial,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { programs } from "./programs";

/**
 * Finance (board accounting) — double-entry general ledger.
 *
 * Money is integer cents. Accounting dates are `date` columns holding the
 * America/Los_Angeles calendar day (never a UTC instant). Journal lines are
 * insert-only (DB trigger); a journal entry can only be voided (once), and
 * nothing dated on/before the finance lock date can be posted or voided
 * (DB trigger reads fin_settings.lock_date). Every entry balances
 * (deferred constraint trigger: sum(debits) = sum(credits) at commit).
 */

export const finAccountTypeEnum = pgEnum("fin_account_type", [
  "asset",
  "liability",
  "net_assets",
  "revenue",
  "expense",
]);

export const finRestrictionEnum = pgEnum("fin_restriction", [
  "without_donor_restrictions",
  "with_donor_restrictions",
]);

export const finRoleEnum = pgEnum("fin_role", ["admin", "editor", "viewer"]);

export const finEntrySourceEnum = pgEnum("fin_entry_source", [
  "manual",
  "opening_balance",
  "bank", // categorized bank-feed transaction
  "transfer", // bank-to-bank transfer
  "registration", // GBYS-run registration charge / refund / offline payment
  "stripe_fee",
  "stripe_payout",
  "platform_fee", // application fee earned on partner-league charges
  // Finance 2:
  "bill",
  "bill_payment",
  "invoice",
  "invoice_payment",
  "donation",
  "reimbursement",
  "fund_release",
]);

export const finBankTxnStatusEnum = pgEnum("fin_bank_txn_status", ["new", "posted", "excluded"]);

export const finRuleMatchEnum = pgEnum("fin_rule_match", ["contains", "equals", "starts_with"]);
export const finRuleDirectionEnum = pgEnum("fin_rule_direction", ["any", "deposit", "withdrawal"]);

/** Chart of accounts (UCOA-style codes). `systemKey` marks accounts the app posts to automatically. */
export const finAccounts = pgTable(
  "fin_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: finAccountTypeEnum("type").notNull(),
    // Free-form grouping for reports, e.g. "Cash", "Program service revenue".
    subtype: text("subtype"),
    description: text("description"),
    parentId: uuid("parent_id"),
    // Stable key for accounts the app posts to (see FIN_SYSTEM_KEYS). Unique; null for user accounts.
    systemKey: text("system_key"),
    // Bank/cash/credit-card account that a bank feed can map to.
    isBank: boolean("is_bank").notNull().default(false),
    // 1099-reportable expense (Finance 2 vendor reporting).
    is1099: boolean("is_1099").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("fin_accounts_code_idx").on(t.code),
    uniqueIndex("fin_accounts_system_key_idx").on(t.systemKey).where(sql`${t.systemKey} is not null`),
  ]
);

/**
 * Funds. The system "General Fund" (systemKey "general") is without donor
 * restrictions. Restricted funds (e.g. "Baseball equipment — donor restricted")
 * optionally point at a program. Every journal line carries a fund.
 */
export const finFunds = pgTable(
  "fin_funds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code"),
    restriction: finRestrictionEnum("restriction").notNull(),
    programId: uuid("program_id").references(() => programs.id),
    purpose: text("purpose"),
    systemKey: text("system_key"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("fin_funds_name_idx").on(t.name),
    uniqueIndex("fin_funds_system_key_idx").on(t.systemKey).where(sql`${t.systemKey} is not null`),
  ]
);

/** Singleton finance settings (id = 1). */
export const finSettings = pgTable(
  "fin_settings",
  {
    id: integer("id").primaryKey().default(1),
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
    // Books are closed through this date (inclusive). Null = nothing closed.
    lockDate: date("lock_date"),
    // Bank GL account Stripe payouts land in (null = account with systemKey "checking").
    stripePayoutAccountId: uuid("stripe_payout_account_id").references(() => finAccounts.id),
    // Date GL auto-posting of registration payments starts (earlier payment_events are ignored).
    autoPostStartDate: date("auto_post_start_date"),
    // Finance 2: bills at/above this amount need two approvers. Null = single approval.
    dualApprovalThresholdCents: integer("dual_approval_threshold_cents"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
  },
  (t) => [
    check("fin_settings_singleton_chk", sql`${t.id} = 1`),
    check("fin_settings_fy_chk", sql`${t.fiscalYearStartMonth} between 1 and 12`),
  ]
);

/** History of period closes / reopens (insert-only). */
export const finPeriodCloses = pgTable("fin_period_closes", {
  id: uuid("id").defaultRandom().primaryKey(),
  lockDate: date("lock_date"), // new lock date (null = fully reopened)
  previousLockDate: date("previous_lock_date"),
  note: text("note"),
  changedByUserId: text("changed_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Finance access grants. Org-wide (programId null): admin / editor / viewer.
 * Program-scoped (programId set): editor / viewer limited to that program's
 * lines. super_admin is an implicit finance admin; board members are implicit
 * org-wide viewers (see src/lib/dal/finance-access.ts).
 */
export const finRoles = pgTable(
  "fin_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: finRoleEnum("role").notNull(),
    programId: uuid("program_id").references(() => programs.id),
    grantedByUserId: text("granted_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: text("revoked_by_user_id").references(() => users.id),
  },
  (t) => [
    uniqueIndex("fin_roles_live_idx")
      .on(t.userId, sql`coalesce(${t.programId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.revokedAt} is null`),
    check("fin_roles_program_admin_chk", sql`${t.programId} is null or ${t.role} <> 'admin'`),
  ]
);

export const finJournalEntries = pgTable(
  "fin_journal_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryNumber: bigserial("entry_number", { mode: "number" }).notNull(),
    entryDate: date("entry_date").notNull(), // LA calendar day
    memo: text("memo").notNull(),
    source: finEntrySourceEnum("source").notNull(),
    // Idempotency key for automatic postings (e.g. payment_event id, po_ id). Unique per source.
    sourceRef: text("source_ref"),
    createdByUserId: text("created_by_user_id").references(() => users.id), // null = system
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: text("voided_by_user_id").references(() => users.id),
    voidReason: text("void_reason"),
    // When an "edit" voids this entry and posts a corrected one.
    replacedByEntryId: uuid("replaced_by_entry_id"),
  },
  (t) => [
    uniqueIndex("fin_journal_entries_number_idx").on(t.entryNumber),
    uniqueIndex("fin_journal_entries_source_ref_idx")
      .on(t.source, t.sourceRef)
      .where(sql`${t.sourceRef} is not null and ${t.voidedAt} is null`),
    index("fin_journal_entries_date_idx").on(t.entryDate),
  ]
);

export const finJournalLines = pgTable(
  "fin_journal_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => finJournalEntries.id),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => finAccounts.id),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => finFunds.id),
    programId: uuid("program_id").references(() => programs.id), // program class
    debitCents: integer("debit_cents").notNull().default(0),
    creditCents: integer("credit_cents").notNull().default(0),
    description: text("description"),
  },
  (t) => [
    index("fin_journal_lines_entry_idx").on(t.entryId),
    index("fin_journal_lines_account_idx").on(t.accountId),
    index("fin_journal_lines_fund_idx").on(t.fundId),
    index("fin_journal_lines_program_idx").on(t.programId),
    check(
      "fin_journal_lines_amount_chk",
      sql`${t.debitCents} >= 0 and ${t.creditCents} >= 0 and (${t.debitCents} = 0) <> (${t.creditCents} = 0)`
    ),
  ]
);

// ---- Banking (SimpleFIN) ----------------------------------------------------

export const finSimplefinConnections = pgTable("fin_simplefin_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: text("label").notNull(),
  // AES-256-GCM ciphertext of the SimpleFIN access URL (src/lib/crypto.ts). Never sent to the client.
  accessUrlCiphertext: text("access_url_ciphertext").notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSyncStatus: text("last_sync_status"), // "ok" | "partial" | "error"
  lastSyncMessages: jsonb("last_sync_messages").$type<string[]>(),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const finBankAccounts = pgTable(
  "fin_bank_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").references(() => finSimplefinConnections.id),
    simplefinAccountId: text("simplefin_account_id"),
    institution: text("institution"),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("USD"),
    // GL account (isBank) this feed posts to. Transactions are not imported until set.
    glAccountId: uuid("gl_account_id").references(() => finAccounts.id),
    // Transactions posted before this LA date are not imported (opening balance covers them).
    importStartDate: date("import_start_date"),
    balanceCents: integer("balance_cents"),
    availableBalanceCents: integer("available_balance_cents"),
    balanceAsOf: timestamp("balance_as_of", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("fin_bank_accounts_sfin_idx")
      .on(t.connectionId, t.simplefinAccountId)
      .where(sql`${t.simplefinAccountId} is not null`),
    uniqueIndex("fin_bank_accounts_gl_idx").on(t.glAccountId).where(sql`${t.glAccountId} is not null`),
  ]
);

export const finBankTransactions = pgTable(
  "fin_bank_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bankAccountId: uuid("bank_account_id")
      .notNull()
      .references(() => finBankAccounts.id),
    externalId: text("external_id").notNull(), // SimpleFIN transaction id
    postedDate: date("posted_date").notNull(), // LA calendar day of `posted`
    amountCents: integer("amount_cents").notNull(), // signed: + deposit, - withdrawal
    description: text("description").notNull(),
    payee: text("payee"),
    memo: text("memo"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    status: finBankTxnStatusEnum("status").notNull().default("new"),
    // The (non-voided) journal entry that accounts for this transaction: created by
    // categorizing it, or an existing entry it was matched to (e.g. a Stripe payout).
    journalEntryId: uuid("journal_entry_id").references(() => finJournalEntries.id),
    // Rule suggestion (not yet applied) shown in the inbox.
    suggestedRuleId: uuid("suggested_rule_id"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fin_bank_txns_external_idx").on(t.bankAccountId, t.externalId),
    // One bank line per entry per account (a transfer entry is matched once in each account).
    uniqueIndex("fin_bank_txns_entry_idx")
      .on(t.bankAccountId, t.journalEntryId)
      .where(sql`${t.journalEntryId} is not null`),
    index("fin_bank_txns_status_idx").on(t.status, t.postedDate),
    check(
      "fin_bank_txns_status_chk",
      sql`(${t.status} = 'posted') = (${t.journalEntryId} is not null)`
    ),
  ]
);

/** Auto-categorization rules for the bank inbox (lowest priority number wins). */
export const finBankRules = pgTable("fin_bank_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  priority: integer("priority").notNull().default(100),
  matchField: text("match_field").notNull().default("description"), // "description" | "payee"
  matchType: finRuleMatchEnum("match_type").notNull().default("contains"),
  matchText: text("match_text").notNull(),
  direction: finRuleDirectionEnum("direction").notNull().default("any"),
  minAmountCents: integer("min_amount_cents"), // absolute value bounds
  maxAmountCents: integer("max_amount_cents"),
  bankAccountId: uuid("bank_account_id").references(() => finBankAccounts.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => finAccounts.id),
  fundId: uuid("fund_id").references(() => finFunds.id),
  programId: uuid("program_id").references(() => programs.id),
  memo: text("memo"),
  autoPost: boolean("auto_post").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const finReconciliations = pgTable(
  "fin_reconciliations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    glAccountId: uuid("gl_account_id")
      .notNull()
      .references(() => finAccounts.id),
    statementEndDate: date("statement_end_date").notNull(),
    statementEndingBalanceCents: integer("statement_ending_balance_cents").notNull(),
    beginningBalanceCents: integer("beginning_balance_cents").notNull(),
    status: text("status").notNull().default("in_progress"), // "in_progress" | "completed"
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedByUserId: text("completed_by_user_id").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("fin_reconciliations_open_idx")
      .on(t.glAccountId)
      .where(sql`${t.status} = 'in_progress'`),
  ]
);

/** Journal lines cleared in a reconciliation (a line clears at most once). */
export const finClearedLines = pgTable(
  "fin_cleared_lines",
  {
    lineId: uuid("line_id")
      .notNull()
      .references(() => finJournalLines.id),
    reconciliationId: uuid("reconciliation_id")
      .notNull()
      .references(() => finReconciliations.id),
  },
  (t) => [primaryKey({ columns: [t.lineId] }), index("fin_cleared_lines_rec_idx").on(t.reconciliationId)]
);

/** Stripe payouts on the GBYS platform account (one GL payout entry each). */
export const finStripePayouts = pgTable("fin_stripe_payouts", {
  id: text("id").primaryKey(), // po_…
  amountCents: integer("amount_cents").notNull(),
  feesCents: integer("fees_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  status: text("status").notNull(),
  arrivalDate: date("arrival_date").notNull(),
  journalEntryId: uuid("journal_entry_id").references(() => finJournalEntries.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
