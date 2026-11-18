CREATE TABLE "volunteer_shift_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"signed_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"checked_in_by_user_id" text,
	"volunteer_log_id" uuid
);
--> statement-breakpoint
ALTER TABLE "user_credentials" ADD COLUMN "expiry_warning_30_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_credentials" ADD COLUMN "expiry_warning_7_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD COLUMN "deletion_reason" text;--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD COLUMN "created_by_user_id" text;--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "volunteer_shift_signups" ADD CONSTRAINT "volunteer_shift_signups_shift_id_volunteer_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."volunteer_shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shift_signups" ADD CONSTRAINT "volunteer_shift_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shift_signups" ADD CONSTRAINT "volunteer_shift_signups_checked_in_by_user_id_users_id_fk" FOREIGN KEY ("checked_in_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shift_signups" ADD CONSTRAINT "volunteer_shift_signups_volunteer_log_id_volunteer_logs_id_fk" FOREIGN KEY ("volunteer_log_id") REFERENCES "public"."volunteer_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_signup_unique_idx" ON "volunteer_shift_signups" USING btree ("shift_id","user_id");--> statement-breakpoint
CREATE INDEX "shift_signups_user_idx" ON "volunteer_shift_signups" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD CONSTRAINT "volunteer_logs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD CONSTRAINT "volunteer_logs_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD CONSTRAINT "volunteer_shifts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "volunteer_logs_shift_user_live_idx" ON "volunteer_logs" USING btree ("shift_id","user_id") WHERE "volunteer_logs"."shift_id" is not null and "volunteer_logs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "volunteer_shifts_starts_idx" ON "volunteer_shifts" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "volunteer_shifts_program_idx" ON "volunteer_shifts" USING btree ("program_id");--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD CONSTRAINT "volunteer_logs_duration_chk" CHECK ("volunteer_logs"."duration_minutes" > 0 and "volunteer_logs"."duration_minutes" <= 1440);--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD CONSTRAINT "volunteer_shifts_window_chk" CHECK ("volunteer_shifts"."ends_at" > "volunteer_shifts"."starts_at");--> statement-breakpoint
ALTER TABLE "volunteer_shifts" ADD CONSTRAINT "volunteer_shifts_spots_chk" CHECK ("volunteer_shifts"."spots_total" >= 1);