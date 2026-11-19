CREATE TYPE "public"."booking_status" AS ENUM('requested', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('complex', 'field', 'gym', 'court', 'cage', 'mat', 'room', 'other');--> statement-breakpoint
CREATE TYPE "public"."team_event_kind" AS ENUM('practice', 'game', 'event');--> statement-breakpoint
CREATE TYPE "public"."team_event_site" AS ENUM('home', 'away', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."team_event_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."team_staff_role" AS ENUM('head_coach', 'assistant_coach', 'team_manager');--> statement-breakpoint
CREATE TABLE "team_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" "team_event_kind" NOT NULL,
	"title" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"resource_id" uuid,
	"booking_id" uuid,
	"location_text" text,
	"opponent" text,
	"site" "team_event_site",
	"series_id" uuid,
	"notes" text,
	"status" "team_event_status" DEFAULT 'scheduled' NOT NULL,
	"created_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_events_window_chk" CHECK ("team_events"."ends_at" > "team_events"."starts_at"),
	CONSTRAINT "team_events_booking_chk" CHECK ("team_events"."booking_id" is null or "team_events"."resource_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "team_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"jersey_number" text,
	"added_by_user_id" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "team_staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "team_staff_role" NOT NULL,
	"added_by_user_id" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"division" text,
	"color" text,
	"calendar_token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_calendar_token_unique" UNIQUE("calendar_token"),
	CONSTRAINT "teams_color_chk" CHECK ("teams"."color" is null or "teams"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "status" "booking_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "decided_by_user_id" text;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "cancelled_by_user_id" text;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "kind" "resource_kind" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "team_events" ADD CONSTRAINT "team_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_events" ADD CONSTRAINT "team_events_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_events" ADD CONSTRAINT "team_events_booking_id_resource_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."resource_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_events" ADD CONSTRAINT "team_events_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_events" ADD CONSTRAINT "team_events_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_staff" ADD CONSTRAINT "team_staff_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_events_team_idx" ON "team_events" USING btree ("team_id","starts_at");--> statement-breakpoint
CREATE INDEX "team_events_series_idx" ON "team_events" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_players_live_reg_idx" ON "team_players" USING btree ("registration_id") WHERE "team_players"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "team_players_team_idx" ON "team_players" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_staff_live_idx" ON "team_staff" USING btree ("team_id","user_id") WHERE "team_staff"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "team_staff_user_idx" ON "team_staff" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_season_name_idx" ON "teams" USING btree ("season_id",lower("name"));--> statement-breakpoint
CREATE INDEX "teams_program_idx" ON "teams" USING btree ("program_id");--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_bookings_status_idx" ON "resource_bookings" USING btree ("status");--> statement-breakpoint
ALTER TABLE "resource_bookings" ADD CONSTRAINT "resource_bookings_window_chk" CHECK ("resource_bookings"."ends_at" > "resource_bookings"."starts_at");