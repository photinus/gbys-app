CREATE TYPE "public"."payment_method" AS ENUM('stripe', 'cash', 'check', 'scholarship');--> statement-breakpoint
CREATE TABLE "waiver_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"body" text NOT NULL,
	"body_hash" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registrations" ALTER COLUMN "payment_method" SET DATA TYPE "public"."payment_method" USING "payment_method"::"public"."payment_method";--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "eligible_birth_date_from" date;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "eligible_birth_date_to" date;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "waiver_version_id" uuid;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "amount_paid_cents" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "payment_recorded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "signed_waivers" ADD COLUMN "waiver_version_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "signed_waivers" ADD COLUMN "signature_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "waiver_versions" ADD CONSTRAINT "waiver_versions_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_versions" ADD CONSTRAINT "waiver_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waiver_versions_program_idx" ON "waiver_versions" USING btree ("program_id");--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_waiver_version_id_waiver_versions_id_fk" FOREIGN KEY ("waiver_version_id") REFERENCES "public"."waiver_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_payment_recorded_by_user_id_users_id_fk" FOREIGN KEY ("payment_recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signed_waivers" ADD CONSTRAINT "signed_waivers_waiver_version_id_waiver_versions_id_fk" FOREIGN KEY ("waiver_version_id") REFERENCES "public"."waiver_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seasons_program_idx" ON "seasons" USING btree ("program_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_season_athlete_live_idx" ON "registrations" USING btree ("season_id","athlete_id") WHERE "registrations"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "signed_waivers_registration_idx" ON "signed_waivers" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "signed_waivers_athlete_idx" ON "signed_waivers" USING btree ("athlete_id");--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_fee_chk" CHECK ("seasons"."base_fee_cents" >= 0);--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_fee_chk" CHECK ("registrations"."fee_cents" >= 0);