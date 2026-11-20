CREATE TYPE "public"."fin_approval_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."fin_bill_kind" AS ENUM('bill', 'reimbursement');--> statement-breakpoint
CREATE TYPE "public"."fin_bill_status" AS ENUM('draft', 'pending_approval', 'approved', 'partially_paid', 'paid', 'rejected', 'void');--> statement-breakpoint
CREATE TYPE "public"."fin_budget_status" AS ENUM('draft', 'adopted');--> statement-breakpoint
CREATE TYPE "public"."fin_gift_kind" AS ENUM('cash', 'check', 'card', 'ach', 'stripe', 'in_kind', 'other');--> statement-breakpoint
CREATE TYPE "public"."fin_invoice_status" AS ENUM('draft', 'open', 'partially_paid', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."fin_payment_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."fin_payment_method" AS ENUM('check', 'ach', 'card', 'cash', 'stripe', 'other');--> statement-breakpoint
CREATE TYPE "public"."fin_receipt_kind" AS ENUM('gift', 'annual');--> statement-breakpoint
CREATE TABLE "fin_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" text,
	CONSTRAINT "fin_attachments_owner_chk" CHECK ("fin_attachments"."owner_type" in ('bill', 'invoice', 'gift', 'contact_w9'))
);
--> statement-breakpoint
CREATE TABLE "fin_bill_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"decision" "fin_approval_decision" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"fund_id" uuid,
	"program_id" uuid,
	"amount_cents" integer NOT NULL,
	"description" text,
	CONSTRAINT "fin_bill_lines_amount_chk" CHECK ("fin_bill_lines"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "fin_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "fin_bill_kind" NOT NULL,
	"contact_id" uuid NOT NULL,
	"payee_user_id" text,
	"vendor_invoice_number" text,
	"program_id" uuid,
	"bill_date" date NOT NULL,
	"due_date" date,
	"memo" text NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"status" "fin_bill_status" DEFAULT 'draft' NOT NULL,
	"approvals_required" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"submitted_by_user_id" text,
	"submitted_at" timestamp with time zone,
	"journal_entry_id" uuid,
	"rejected_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_bills_amounts_chk" CHECK ("fin_bills"."total_cents" >= 0 and "fin_bills"."paid_cents" >= 0 and "fin_bills"."paid_cents" <= "fin_bills"."total_cents"),
	CONSTRAINT "fin_bills_approvals_chk" CHECK ("fin_bills"."approvals_required" between 1 and 2)
);
--> statement-breakpoint
CREATE TABLE "fin_budget_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"program_id" uuid,
	"monthly_cents" integer[] NOT NULL,
	"note" text,
	CONSTRAINT "fin_budget_lines_months_chk" CHECK (cardinality("fin_budget_lines"."monthly_cents") = 12)
);
--> statement-breakpoint
CREATE TABLE "fin_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"fiscal_year_start" date NOT NULL,
	"fiscal_year_end" date NOT NULL,
	"status" "fin_budget_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"adopted_at" timestamp with time zone,
	"adopted_by_user_id" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"kind" text DEFAULT 'organization' NOT NULL,
	"email" text,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"is_vendor" boolean DEFAULT false NOT NULL,
	"is_customer" boolean DEFAULT false NOT NULL,
	"is_donor" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"is_1099" boolean DEFAULT false NOT NULL,
	"tax_id_type" text,
	"tax_id_ciphertext" text,
	"tax_id_last4" text,
	"w9_received_on" date,
	"default_account_id" uuid,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fin_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donor_contact_id" uuid,
	"gift_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"kind" "fin_gift_kind" NOT NULL,
	"fund_id" uuid NOT NULL,
	"program_id" uuid,
	"revenue_account_id" uuid NOT NULL,
	"deposit_account_id" uuid,
	"in_kind_debit_account_id" uuid,
	"in_kind_description" text,
	"goods_services_cents" integer DEFAULT 0 NOT NULL,
	"goods_services_description" text,
	"campaign" text,
	"reference" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"note" text,
	"journal_entry_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	CONSTRAINT "fin_gifts_amount_chk" CHECK ("fin_gifts"."amount_cents" > 0),
	CONSTRAINT "fin_gifts_qpq_chk" CHECK ("fin_gifts"."goods_services_cents" >= 0 and "fin_gifts"."goods_services_cents" <= "fin_gifts"."amount_cents"),
	CONSTRAINT "fin_gifts_kind_chk" CHECK (("fin_gifts"."kind" = 'in_kind') = ("fin_gifts"."deposit_account_id" is null) and ("fin_gifts"."kind" <> 'in_kind' or "fin_gifts"."in_kind_debit_account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "fin_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"fund_id" uuid,
	"program_id" uuid,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "fin_invoice_lines_amount_chk" CHECK ("fin_invoice_lines"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "fin_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"contact_id" uuid NOT NULL,
	"program_id" uuid,
	"issue_date" date NOT NULL,
	"due_date" date,
	"memo" text,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"status" "fin_invoice_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid,
	"sent_at" timestamp with time zone,
	"sent_to_email" text,
	"created_by_user_id" text NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_invoices_amounts_chk" CHECK ("fin_invoices"."total_cents" >= 0 and "fin_invoices"."paid_cents" >= 0 and "fin_invoices"."paid_cents" <= "fin_invoices"."total_cents")
);
--> statement-breakpoint
CREATE TABLE "fin_payment_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"bill_id" uuid,
	"invoice_id" uuid,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "fin_payment_apps_target_chk" CHECK (("fin_payment_applications"."bill_id" is null) <> ("fin_payment_applications"."invoice_id" is null)),
	CONSTRAINT "fin_payment_apps_amount_chk" CHECK ("fin_payment_applications"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "fin_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" "fin_payment_direction" NOT NULL,
	"contact_id" uuid NOT NULL,
	"payment_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "fin_payment_method" NOT NULL,
	"reference" text,
	"account_id" uuid NOT NULL,
	"memo" text,
	"journal_entry_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	CONSTRAINT "fin_payments_amount_chk" CHECK ("fin_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "fin_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "fin_receipt_kind" NOT NULL,
	"gift_id" uuid,
	"contact_id" uuid NOT NULL,
	"tax_year" integer,
	"method" text NOT NULL,
	"sent_to" text,
	"amount_cents" integer NOT NULL,
	"deductible_cents" integer NOT NULL,
	"sent_by_user_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_receipts_kind_chk" CHECK (("fin_receipts"."kind" = 'gift' and "fin_receipts"."gift_id" is not null) or ("fin_receipts"."kind" = 'annual' and "fin_receipts"."tax_year" is not null))
);
--> statement-breakpoint
ALTER TABLE "fin_settings" ADD COLUMN "receipt_signer_name" text;--> statement-breakpoint
ALTER TABLE "fin_settings" ADD COLUMN "receipt_signer_title" text;--> statement-breakpoint
ALTER TABLE "fin_settings" ADD COLUMN "receipt_message" text;--> statement-breakpoint
ALTER TABLE "fin_settings" ADD COLUMN "invoice_payment_instructions" text;--> statement-breakpoint
ALTER TABLE "fin_attachments" ADD CONSTRAINT "fin_attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_attachments" ADD CONSTRAINT "fin_attachments_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bill_approvals" ADD CONSTRAINT "fin_bill_approvals_bill_id_fin_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."fin_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bill_approvals" ADD CONSTRAINT "fin_bill_approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bill_lines" ADD CONSTRAINT "fin_bill_lines_bill_id_fin_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."fin_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bill_lines" ADD CONSTRAINT "fin_bill_lines_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bill_lines" ADD CONSTRAINT "fin_bill_lines_fund_id_fin_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."fin_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bill_lines" ADD CONSTRAINT "fin_bill_lines_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bills" ADD CONSTRAINT "fin_bills_contact_id_fin_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."fin_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bills" ADD CONSTRAINT "fin_bills_payee_user_id_users_id_fk" FOREIGN KEY ("payee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bills" ADD CONSTRAINT "fin_bills_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bills" ADD CONSTRAINT "fin_bills_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bills" ADD CONSTRAINT "fin_bills_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bills" ADD CONSTRAINT "fin_bills_journal_entry_id_fin_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."fin_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_bills" ADD CONSTRAINT "fin_bills_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_budget_lines" ADD CONSTRAINT "fin_budget_lines_budget_id_fin_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."fin_budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_budget_lines" ADD CONSTRAINT "fin_budget_lines_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_budget_lines" ADD CONSTRAINT "fin_budget_lines_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_budgets" ADD CONSTRAINT "fin_budgets_adopted_by_user_id_users_id_fk" FOREIGN KEY ("adopted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_budgets" ADD CONSTRAINT "fin_budgets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_contacts" ADD CONSTRAINT "fin_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_contacts" ADD CONSTRAINT "fin_contacts_default_account_id_fin_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_contacts" ADD CONSTRAINT "fin_contacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_donor_contact_id_fin_contacts_id_fk" FOREIGN KEY ("donor_contact_id") REFERENCES "public"."fin_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_fund_id_fin_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."fin_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_revenue_account_id_fin_accounts_id_fk" FOREIGN KEY ("revenue_account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_deposit_account_id_fin_accounts_id_fk" FOREIGN KEY ("deposit_account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_in_kind_debit_account_id_fin_accounts_id_fk" FOREIGN KEY ("in_kind_debit_account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_journal_entry_id_fin_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."fin_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_gifts" ADD CONSTRAINT "fin_gifts_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoice_lines" ADD CONSTRAINT "fin_invoice_lines_invoice_id_fin_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fin_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoice_lines" ADD CONSTRAINT "fin_invoice_lines_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoice_lines" ADD CONSTRAINT "fin_invoice_lines_fund_id_fin_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."fin_funds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoice_lines" ADD CONSTRAINT "fin_invoice_lines_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoices" ADD CONSTRAINT "fin_invoices_contact_id_fin_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."fin_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoices" ADD CONSTRAINT "fin_invoices_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoices" ADD CONSTRAINT "fin_invoices_journal_entry_id_fin_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."fin_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoices" ADD CONSTRAINT "fin_invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_invoices" ADD CONSTRAINT "fin_invoices_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_payment_applications" ADD CONSTRAINT "fin_payment_applications_payment_id_fin_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."fin_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_payment_applications" ADD CONSTRAINT "fin_payment_applications_bill_id_fin_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."fin_bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_payment_applications" ADD CONSTRAINT "fin_payment_applications_invoice_id_fin_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."fin_invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_payments" ADD CONSTRAINT "fin_payments_contact_id_fin_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."fin_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_payments" ADD CONSTRAINT "fin_payments_account_id_fin_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."fin_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_payments" ADD CONSTRAINT "fin_payments_journal_entry_id_fin_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."fin_journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_payments" ADD CONSTRAINT "fin_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_payments" ADD CONSTRAINT "fin_payments_voided_by_user_id_users_id_fk" FOREIGN KEY ("voided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_receipts" ADD CONSTRAINT "fin_receipts_gift_id_fin_gifts_id_fk" FOREIGN KEY ("gift_id") REFERENCES "public"."fin_gifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_receipts" ADD CONSTRAINT "fin_receipts_contact_id_fin_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."fin_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin_receipts" ADD CONSTRAINT "fin_receipts_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fin_attachments_owner_idx" ON "fin_attachments" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_bill_approvals_once_idx" ON "fin_bill_approvals" USING btree ("bill_id","submitted_at","user_id");--> statement-breakpoint
CREATE INDEX "fin_bill_lines_bill_idx" ON "fin_bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "fin_bills_status_idx" ON "fin_bills" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "fin_bills_contact_idx" ON "fin_bills" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "fin_bills_program_idx" ON "fin_bills" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "fin_bills_payee_idx" ON "fin_bills" USING btree ("payee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_budget_lines_key_idx" ON "fin_budget_lines" USING btree ("budget_id","account_id",coalesce("program_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "fin_contacts_name_idx" ON "fin_contacts" USING btree ("display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_contacts_user_idx" ON "fin_contacts" USING btree ("user_id") WHERE "fin_contacts"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "fin_gifts_donor_idx" ON "fin_gifts" USING btree ("donor_contact_id","gift_date");--> statement-breakpoint
CREATE INDEX "fin_gifts_date_idx" ON "fin_gifts" USING btree ("gift_date");--> statement-breakpoint
CREATE INDEX "fin_gifts_fund_idx" ON "fin_gifts" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "fin_invoice_lines_invoice_idx" ON "fin_invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fin_invoices_number_idx" ON "fin_invoices" USING btree ("number");--> statement-breakpoint
CREATE INDEX "fin_invoices_status_idx" ON "fin_invoices" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "fin_invoices_contact_idx" ON "fin_invoices" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "fin_payment_apps_payment_idx" ON "fin_payment_applications" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "fin_payment_apps_bill_idx" ON "fin_payment_applications" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "fin_payment_apps_invoice_idx" ON "fin_payment_applications" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "fin_payments_contact_idx" ON "fin_payments" USING btree ("contact_id","payment_date");--> statement-breakpoint
CREATE INDEX "fin_receipts_gift_idx" ON "fin_receipts" USING btree ("gift_id");--> statement-breakpoint
CREATE INDEX "fin_receipts_contact_idx" ON "fin_receipts" USING btree ("contact_id","tax_year");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS fin_invoice_number_seq START WITH 1001;--> statement-breakpoint
CREATE OR REPLACE FUNCTION fin_insert_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (insert-only log)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER fin_bill_approvals_immutable BEFORE UPDATE OR DELETE ON "fin_bill_approvals"
  FOR EACH ROW EXECUTE FUNCTION fin_insert_only();--> statement-breakpoint
CREATE TRIGGER fin_bill_approvals_no_truncate BEFORE TRUNCATE ON "fin_bill_approvals"
  FOR EACH STATEMENT EXECUTE FUNCTION fin_insert_only();--> statement-breakpoint
CREATE TRIGGER fin_receipts_immutable BEFORE UPDATE OR DELETE ON "fin_receipts"
  FOR EACH ROW EXECUTE FUNCTION fin_insert_only();--> statement-breakpoint
CREATE TRIGGER fin_receipts_no_truncate BEFORE TRUNCATE ON "fin_receipts"
  FOR EACH STATEMENT EXECUTE FUNCTION fin_insert_only();
