CREATE TYPE "public"."fin_account_type" AS ENUM('asset', 'liability', 'net_assets', 'revenue', 'expense');--> statement-breakpoint
CREATE TYPE "public"."fin_bank_txn_status" AS ENUM('new', 'posted', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."fin_entry_source" AS ENUM('manual', 'opening_balance', 'bank', 'transfer', 'registration', 'stripe_fee', 'stripe_payout', 'platform_fee', 'bill', 'bill_payment', 'invoice', 'invoice_payment', 'donation', 'reimbursement', 'fund_release');--> statement-breakpoint
CREATE TYPE "public"."fin_restriction" AS ENUM('without_donor_restrictions', 'with_donor_restrictions');--> statement-breakpoint
CREATE TYPE "public"."fin_role" AS ENUM('admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."fin_rule_direction" AS ENUM('any', 'deposit', 'withdrawal');--> statement-breakpoint
CREATE TYPE "public"."fin_rule_match" AS ENUM('contains', 'equals', 'starts_with');--> statement-breakpoint
CREATE TABLE "fin_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "fin_account_type" NOT NULL,
	"subtype" text,
	"description" text,
	"parent_id" uuid,
	"system_key" text,
	"is_bank" boolean DEFAULT false NOT NULL,
	"is_1099" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid,
	"simplefin_account_id" text,
	"institution" text,
	"name" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"gl_account_id" uuid,
	"import_start_date" date,
	"balance_cents" integer,
	"available_balance_cents" integer,
	"balance_as_of" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_bank_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"match_field" text DEFAULT 'description' NOT NULL,
	"match_type" "fin_rule_match" DEFAULT 'contains' NOT NULL,
	"match_text" text NOT NULL,
	"direction" "fin_rule_direction" DEFAULT 'any' NOT NULL,
	"min_amount_cents" integer,
	"max_amount_cents" integer,
	"bank_account_id" uuid,
	"account_id" uuid NOT NULL,
	"fund_id" uuid,
	"program_id" uuid,
	"memo" text,
	"auto_post" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"posted_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"payee" text,
	"memo" text,
	"raw" jsonb,
	"status" "fin_bank_txn_status" DEFAULT 'new' NOT NULL,
	"journal_entry_id" uuid,
	"suggested_rule_id" uuid,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_bank_txns_status_chk" CHECK (("fin_bank_transactions"."status" = 'posted') = ("fin_bank_transactions"."journal_entry_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "fin_cleared_lines" (
	"line_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	CONSTRAINT "fin_cleared_lines_line_id_pk" PRIMARY KEY("line_id")
);
--> statement-breakpoint
CREATE TABLE "fin_funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"restriction" "fin_restriction" NOT NULL,
	"program_id" uuid,
	"purpose" text,
	"system_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_number" bigserial NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text NOT NULL,
	"source" "fin_entry_source" NOT NULL,
	"source_ref" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	"replaced_by_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "fin_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"fund_id" uuid NOT NULL,
	"program_id" uuid,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"description" text,
	CONSTRAINT "fin_journal_lines_amount_chk" CHECK ("fin_journal_lines"."debit_cents" >= 0 and "fin_journal_lines"."credit_cents" >= 0 and ("fin_journal_lines"."debit_cents" = 0) <> ("fin_journal_lines"."credit_cents" = 0))
);
--> statement-breakpoint
CREATE TABLE "fin_period_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lock_date" date,
	"previous_lock_date" date,
	"note" text,
	"changed_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"statement_end_date" date NOT NULL,
	"statement_ending_balance_cents" integer NOT NULL,
	"beginning_balance_cents" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by_user_id" text,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fin_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" "fin_role" NOT NULL,
	"program_id" uuid,
	"granted_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	CONSTRAINT "fin_roles_program_admin_chk" CHECK ("fin_roles"."program_id" is null or "fin_roles"."role" <> 'admin')
);
--> statement-breakpoint
CREATE TABLE "fin_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
	"lock_date" date,
	"stripe_payout_account_id" uuid,
	"auto_post_start_date" date,
	"dual_approval_threshold_cents" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	CONSTRAINT "fin_settings_singleton_chk" CHECK ("fin_settings"."id" = 1),
	CONSTRAINT "fin_settings_fy_chk" CHECK ("fin_settings"."fiscal_year_start_month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "fin_simplefin_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"access_url_ciphertext" text NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_messages" jsonb,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fin_stripe_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"amount_cents" integer NOT NULL,
	"fees_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text NOT NULL,
	"arrival_date" date NOT NULL,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fin_bank_accounts" ADD CONSTRAINT "fin_bank_accounts_connection_id_fin_simplefin_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."fin_simplefin_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_accounts" ADD CONSTRAINT "fin_bank_accounts_gl_account_id_fin_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_rules" ADD CONSTRAINT "fin_bank_rules_bank_account_id_fin_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."fin_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_rules" ADD CONSTRAINT "fin_bank_rules_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_rules" ADD CONSTRAINT "fin_bank_rules_fund_id_fin_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."fin_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_rules" ADD CONSTRAINT "fin_bank_rules_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_rules" ADD CONSTRAINT "fin_bank_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_transactions" ADD CONSTRAINT "fin_bank_transactions_bank_account_id_fin_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."fin_bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_transactions" ADD CONSTRAINT "fin_bank_transactions_journal_entry_id_fin_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."fin_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bank_transactions" ADD CONSTRAINT "fin_bank_transactions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_cleared_lines" ADD CONSTRAINT "fin_cleared_lines_line_id_fin_journal_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."fin_journal_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_cleared_lines" ADD CONSTRAINT "fin_cleared_lines_reconciliation_id_fin_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."fin_reconciliations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_funds" ADD CONSTRAINT "fin_funds_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_entries" ADD CONSTRAINT "fin_journal_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_entries" ADD CONSTRAINT "fin_journal_entries_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_entry_id_fin_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."fin_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_fund_id_fin_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."fin_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_journal_lines" ADD CONSTRAINT "fin_journal_lines_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_period_closes" ADD CONSTRAINT "fin_period_closes_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_gl_account_id_fin_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_reconciliations" ADD CONSTRAINT "fin_reconciliations_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_roles" ADD CONSTRAINT "fin_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_roles" ADD CONSTRAINT "fin_roles_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_roles" ADD CONSTRAINT "fin_roles_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_roles" ADD CONSTRAINT "fin_roles_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_settings" ADD CONSTRAINT "fin_settings_stripe_payout_account_id_fin_accounts_id_fk" FOREIGN KEY ("stripe_payout_account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_settings" ADD CONSTRAINT "fin_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_simplefin_connections" ADD CONSTRAINT "fin_simplefin_connections_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_stripe_payouts" ADD CONSTRAINT "fin_stripe_payouts_journal_entry_id_fin_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."fin_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fin_accounts_code_idx" ON "fin_accounts" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_accounts_system_key_idx" ON "fin_accounts" USING btree ("system_key") WHERE "fin_accounts"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bank_accounts_sfin_idx" ON "fin_bank_accounts" USING btree ("connection_id","simplefin_account_id") WHERE "fin_bank_accounts"."simplefin_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bank_accounts_gl_idx" ON "fin_bank_accounts" USING btree ("gl_account_id") WHERE "fin_bank_accounts"."gl_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bank_txns_external_idx" ON "fin_bank_transactions" USING btree ("bank_account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bank_txns_entry_idx" ON "fin_bank_transactions" USING btree ("bank_account_id","journal_entry_id") WHERE "fin_bank_transactions"."journal_entry_id" is not null;--> statement-breakpoint
CREATE INDEX "fin_bank_txns_status_idx" ON "fin_bank_transactions" USING btree ("status","posted_date");--> statement-breakpoint
CREATE INDEX "fin_cleared_lines_rec_idx" ON "fin_cleared_lines" USING btree ("reconciliation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_funds_name_idx" ON "fin_funds" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_funds_system_key_idx" ON "fin_funds" USING btree ("system_key") WHERE "fin_funds"."system_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "fin_journal_entries_number_idx" ON "fin_journal_entries" USING btree ("entry_number");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_journal_entries_source_ref_idx" ON "fin_journal_entries" USING btree ("source","source_ref") WHERE "fin_journal_entries"."source_ref" is not null and "fin_journal_entries"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "fin_journal_entries_date_idx" ON "fin_journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "fin_journal_lines_entry_idx" ON "fin_journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "fin_journal_lines_account_idx" ON "fin_journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "fin_journal_lines_fund_idx" ON "fin_journal_lines" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "fin_journal_lines_program_idx" ON "fin_journal_lines" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_reconciliations_open_idx" ON "fin_reconciliations" USING btree ("gl_account_id") WHERE "fin_reconciliations"."status" = 'in_progress';--> statement-breakpoint
CREATE UNIQUE INDEX "fin_roles_live_idx" ON "fin_roles" USING btree ("user_id",coalesce("program_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "fin_roles"."revoked_at" is null;--> statement-breakpoint
-- ===== Ledger integrity triggers (hand-written) =====
CREATE OR REPLACE FUNCTION fin_lock_date() RETURNS date AS $$
  SELECT lock_date FROM fin_settings WHERE id = 1;
$$ LANGUAGE sql STABLE;--> statement-breakpoint
CREATE OR REPLACE FUNCTION fin_journal_lines_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fin_journal_lines rows are immutable (void the entry instead)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER fin_journal_lines_no_update_delete BEFORE UPDATE OR DELETE ON "fin_journal_lines"
  FOR EACH ROW EXECUTE FUNCTION fin_journal_lines_immutable();--> statement-breakpoint
CREATE TRIGGER fin_journal_lines_no_truncate BEFORE TRUNCATE ON "fin_journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION fin_journal_lines_immutable();--> statement-breakpoint
CREATE OR REPLACE FUNCTION fin_journal_lines_insert_guard() RETURNS trigger AS $$
DECLARE e record;
BEGIN
  SELECT entry_date, voided_at INTO e FROM fin_journal_entries WHERE id = NEW.entry_id;
  IF e.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot add lines to a voided journal entry';
  END IF;
  IF fin_lock_date() IS NOT NULL AND e.entry_date <= fin_lock_date() THEN
    RAISE EXCEPTION 'books are closed through %', fin_lock_date();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER fin_journal_lines_insert_guard BEFORE INSERT ON "fin_journal_lines"
  FOR EACH ROW EXECUTE FUNCTION fin_journal_lines_insert_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION fin_journal_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'fin_journal_entries cannot be deleted (void instead)';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF fin_lock_date() IS NOT NULL AND NEW.entry_date <= fin_lock_date() THEN
      RAISE EXCEPTION 'books are closed through %', fin_lock_date();
    END IF;
    IF NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'cannot insert a voided journal entry';
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: only a one-time void (plus linking the replacement entry) is allowed.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.entry_number IS DISTINCT FROM OLD.entry_number
     OR NEW.entry_date IS DISTINCT FROM OLD.entry_date OR NEW.memo IS DISTINCT FROM OLD.memo
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'posted journal entries are immutable (void and re-post instead)';
  END IF;
  IF OLD.voided_at IS NOT NULL THEN
    IF NEW.voided_at IS DISTINCT FROM OLD.voided_at OR NEW.voided_by_user_id IS DISTINCT FROM OLD.voided_by_user_id
       OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
       OR (OLD.replaced_by_entry_id IS NOT NULL AND NEW.replaced_by_entry_id IS DISTINCT FROM OLD.replaced_by_entry_id) THEN
      RAISE EXCEPTION 'journal entry is already voided';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.voided_at IS NULL THEN
    RAISE EXCEPTION 'posted journal entries are immutable (void and re-post instead)';
  END IF;
  IF fin_lock_date() IS NOT NULL AND OLD.entry_date <= fin_lock_date() THEN
    RAISE EXCEPTION 'books are closed through %', fin_lock_date();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER fin_journal_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON "fin_journal_entries"
  FOR EACH ROW EXECUTE FUNCTION fin_journal_entries_guard();--> statement-breakpoint
CREATE TRIGGER fin_journal_entries_no_truncate BEFORE TRUNCATE ON "fin_journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION fin_journal_entries_guard();--> statement-breakpoint
-- Every entry must have >= 2 lines and balance, checked at COMMIT.
CREATE OR REPLACE FUNCTION fin_entry_balance_check() RETURNS trigger AS $$
DECLARE eid uuid; n int; d bigint; c bigint;
BEGIN
  IF TG_TABLE_NAME = 'fin_journal_entries' THEN eid := NEW.id; ELSE eid := NEW.entry_id; END IF;
  SELECT count(*), coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
    INTO n, d, c FROM fin_journal_lines WHERE entry_id = eid;
  IF n < 2 OR d <> c OR d = 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance (lines %, debits %, credits %)', eid, n, d, c;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fin_entries_balanced AFTER INSERT ON "fin_journal_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_entry_balance_check();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER fin_lines_balanced AFTER INSERT ON "fin_journal_lines"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fin_entry_balance_check();--> statement-breakpoint
CREATE OR REPLACE FUNCTION fin_period_closes_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fin_period_closes rows are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER fin_period_closes_no_update_delete BEFORE UPDATE OR DELETE ON "fin_period_closes"
  FOR EACH ROW EXECUTE FUNCTION fin_period_closes_immutable();--> statement-breakpoint
CREATE TRIGGER fin_period_closes_no_truncate BEFORE TRUNCATE ON "fin_period_closes"
  FOR EACH STATEMENT EXECUTE FUNCTION fin_period_closes_immutable();--> statement-breakpoint
-- ===== Seed: settings, General Fund, nonprofit chart of accounts (UCOA-style) =====
INSERT INTO "fin_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "fin_funds" ("name", "code", "restriction", "purpose", "system_key") VALUES
  ('General Fund', 'GEN', 'without_donor_restrictions', 'Unrestricted operating funds', 'general')
  ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "fin_accounts" ("code", "name", "type", "subtype", "system_key", "is_bank", "is_1099") VALUES
  ('1000', 'Checking', 'asset', 'Cash', 'checking', true, false),
  ('1010', 'Savings', 'asset', 'Cash', NULL, true, false),
  ('1020', 'Petty cash', 'asset', 'Cash', NULL, true, false),
  ('1050', 'Stripe balance', 'asset', 'Cash', 'stripe_clearing', false, false),
  ('1060', 'Undeposited funds', 'asset', 'Cash', 'undeposited_funds', false, false),
  ('1200', 'Accounts receivable', 'asset', 'Receivables', 'accounts_receivable', false, false),
  ('1210', 'Pledges receivable', 'asset', 'Receivables', 'pledges_receivable', false, false),
  ('1300', 'Prepaid expenses', 'asset', 'Other assets', NULL, false, false),
  ('1500', 'Equipment', 'asset', 'Fixed assets', NULL, false, false),
  ('1510', 'Accumulated depreciation', 'asset', 'Fixed assets', NULL, false, false),
  ('2000', 'Accounts payable', 'liability', 'Payables', 'accounts_payable', false, false),
  ('2010', 'Reimbursements payable', 'liability', 'Payables', 'reimbursements_payable', false, false),
  ('2100', 'Credit card', 'liability', 'Credit cards', NULL, true, false),
  ('2200', 'Deferred registration revenue', 'liability', 'Deferred revenue', 'deferred_revenue', false, false),
  ('3000', 'Net assets without donor restrictions', 'net_assets', 'Net assets', 'net_assets_unrestricted', false, false),
  ('3100', 'Net assets with donor restrictions', 'net_assets', 'Net assets', 'net_assets_restricted', false, false),
  ('4010', 'Individual contributions', 'revenue', 'Contributions', 'contributions', false, false),
  ('4020', 'Business contributions', 'revenue', 'Contributions', NULL, false, false),
  ('4030', 'Foundation grants', 'revenue', 'Grants', NULL, false, false),
  ('4040', 'Government grants', 'revenue', 'Grants', NULL, false, false),
  ('4070', 'In-kind contributions', 'revenue', 'Contributions', 'in_kind_contributions', false, false),
  ('4100', 'Fundraising event revenue', 'revenue', 'Fundraising events', NULL, false, false),
  ('4110', 'Sponsorships', 'revenue', 'Contributions', NULL, false, false),
  ('4200', 'Registration fees', 'revenue', 'Program service revenue', 'registration_revenue', false, false),
  ('4210', 'Concessions sales', 'revenue', 'Program service revenue', NULL, false, false),
  ('4220', 'Uniform & merchandise sales', 'revenue', 'Program service revenue', NULL, false, false),
  ('4300', 'Partner platform fees', 'revenue', 'Program service revenue', 'platform_fee_revenue', false, false),
  ('4400', 'Interest income', 'revenue', 'Other revenue', NULL, false, false),
  ('4900', 'Other revenue', 'revenue', 'Other revenue', NULL, false, false),
  ('5010', 'Equipment & supplies', 'expense', 'Program expenses', NULL, false, false),
  ('5020', 'Uniforms', 'expense', 'Program expenses', NULL, false, false),
  ('5030', 'Referee & official fees', 'expense', 'Program expenses', NULL, false, true),
  ('5040', 'Facility rental', 'expense', 'Program expenses', NULL, false, true),
  ('5050', 'League & tournament fees', 'expense', 'Program expenses', NULL, false, false),
  ('5060', 'Insurance', 'expense', 'Management & general', NULL, false, false),
  ('5070', 'Background checks', 'expense', 'Program expenses', NULL, false, false),
  ('5080', 'Awards & trophies', 'expense', 'Program expenses', NULL, false, false),
  ('5090', 'Field maintenance', 'expense', 'Program expenses', NULL, false, true),
  ('5100', 'Concessions supplies', 'expense', 'Program expenses', NULL, false, false),
  ('5200', 'Fundraising expenses', 'expense', 'Fundraising', NULL, false, false),
  ('6010', 'Payment processing fees', 'expense', 'Management & general', 'payment_processing_fees', false, false),
  ('6020', 'Bank service charges', 'expense', 'Management & general', NULL, false, false),
  ('6030', 'Accounting & professional fees', 'expense', 'Management & general', NULL, false, true),
  ('6040', 'Software & subscriptions', 'expense', 'Management & general', NULL, false, false),
  ('6050', 'Office supplies & postage', 'expense', 'Management & general', NULL, false, false),
  ('6060', 'Licenses, dues & filing fees', 'expense', 'Management & general', NULL, false, false),
  ('6070', 'Marketing & printing', 'expense', 'Management & general', NULL, false, false),
  ('6080', 'Travel & mileage', 'expense', 'Program expenses', NULL, false, false),
  ('6100', 'In-kind expense', 'expense', 'Program expenses', 'in_kind_expense', false, false),
  ('6900', 'Miscellaneous expense', 'expense', 'Management & general', NULL, false, false)
  ON CONFLICT DO NOTHING;
