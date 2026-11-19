CREATE TYPE "public"."contact_submission_status" AS ENUM('new', 'read', 'archived', 'spam');--> statement-breakpoint
CREATE TABLE "contact_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"intro" text,
	"collect_phone" boolean DEFAULT false NOT NULL,
	"phone_required" boolean DEFAULT false NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recipient_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify_program_admins" boolean DEFAULT true NOT NULL,
	"submit_label" text DEFAULT 'Send message' NOT NULL,
	"success_message" text DEFAULT 'Thanks! We''ll get back to you soon.' NOT NULL,
	"privacy_note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_forms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "contact_forms_phone_chk" CHECK ("contact_forms"."collect_phone" or not "contact_forms"."phone_required")
);
--> statement-breakpoint
CREATE TABLE "contact_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"program_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"message" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "contact_submission_status" DEFAULT 'new' NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"embed_referrer" text,
	"notification_sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"read_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_forms" ADD CONSTRAINT "contact_forms_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_forms" ADD CONSTRAINT "contact_forms_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_form_id_contact_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."contact_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_submissions" ADD CONSTRAINT "contact_submissions_read_by_user_id_users_id_fk" FOREIGN KEY ("read_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_forms_program_idx" ON "contact_forms" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "contact_submissions_form_idx" ON "contact_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_submissions_program_idx" ON "contact_submissions" USING btree ("program_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_submissions_ip_idx" ON "contact_submissions" USING btree ("ip_hash","created_at");