CREATE TYPE "public"."payment_event_kind" AS ENUM('charge', 'refund', 'dispute_opened', 'dispute_closed', 'offline_payment', 'offline_void');--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"program_id" uuid,
	"kind" "payment_event_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"application_fee_cents" integer,
	"stripe_object_id" text,
	"stripe_account_id" text,
	"method" "payment_method",
	"note" text,
	"recorded_by_user_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_stripe_object_id_unique" UNIQUE("stripe_object_id"),
	CONSTRAINT "payment_events_amount_chk" CHECK ("payment_events"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "stripe_charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "stripe_details_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "stripe_account_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "platform_fee_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "platform_fee_charged_cents" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_events_registration_idx" ON "payment_events" USING btree ("registration_id");--> statement-breakpoint
CREATE INDEX "payment_events_program_idx" ON "payment_events" USING btree ("program_id","occurred_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION payment_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payment_events rows are immutable (append-only ledger)';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER payment_events_no_update_delete BEFORE UPDATE OR DELETE ON "payment_events"
  FOR EACH ROW EXECUTE FUNCTION payment_events_immutable();--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_platform_fee_chk" CHECK ("platform_fee_cents" >= 0 AND "platform_fee_bps" BETWEEN 0 AND 3000);
