CREATE TYPE "public"."board_attendance_status" AS ENUM('present', 'remote', 'absent', 'excused');--> statement-breakpoint
CREATE TYPE "public"."board_meeting_kind" AS ENUM('regular', 'special', 'annual');--> statement-breakpoint
CREATE TYPE "public"."board_meeting_status" AS ENUM('scheduled', 'held', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."board_minutes_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."board_motion_kind" AS ENUM('in_meeting', 'without_meeting');--> statement-breakpoint
CREATE TYPE "public"."board_motion_status" AS ENUM('draft', 'open', 'passed', 'failed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."board_motion_threshold" AS ENUM('majority_of_votes_cast', 'two_thirds_of_votes_cast', 'unanimous_of_directors');--> statement-breakpoint
CREATE TYPE "public"."board_vote_choice" AS ENUM('yes', 'no', 'abstain');--> statement-breakpoint
CREATE TABLE "board_meeting_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"board_member_id" uuid NOT NULL,
	"status" "board_attendance_status" NOT NULL,
	"recorded_by_user_id" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" "board_meeting_kind" DEFAULT 'regular' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text,
	"virtual_url" text,
	"agenda" text,
	"status" "board_meeting_status" DEFAULT 'scheduled' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_meetings_window_chk" CHECK ("board_meetings"."ends_at" is null or "board_meetings"."ends_at" > "board_meetings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "board_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"display_name" text NOT NULL,
	"position" text NOT NULL,
	"is_voting_director" boolean DEFAULT true NOT NULL,
	"term_start" date NOT NULL,
	"term_end" date,
	"elected_on" date,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_members_term_chk" CHECK ("board_members"."term_end" is null or "board_members"."term_end" >= "board_members"."term_start")
);
--> statement-breakpoint
CREATE TABLE "board_minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"status" "board_minutes_status" DEFAULT 'draft' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_via_motion_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_minutes_public_chk" CHECK (not "board_minutes"."is_public" or "board_minutes"."status" = 'approved')
);
--> statement-breakpoint
CREATE TABLE "board_motions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid,
	"kind" "board_motion_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"threshold" "board_motion_threshold" DEFAULT 'majority_of_votes_cast' NOT NULL,
	"quorum_required" integer,
	"status" "board_motion_status" DEFAULT 'draft' NOT NULL,
	"eligible_board_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"result" jsonb,
	"moved_by_board_member_id" uuid,
	"seconded_by_board_member_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_motions_meeting_chk" CHECK ("board_motions"."kind" <> 'in_meeting' or "board_motions"."meeting_id" is not null),
	CONSTRAINT "board_motions_wom_unanimous_chk" CHECK ("board_motions"."kind" <> 'without_meeting' or "board_motions"."threshold" = 'unanimous_of_directors')
);
--> statement-breakpoint
CREATE TABLE "board_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"motion_id" uuid NOT NULL,
	"board_member_id" uuid NOT NULL,
	"user_id" text,
	"choice" "board_vote_choice" NOT NULL,
	"recorded_by_user_id" text NOT NULL,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_object_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "photo_object_key" text;--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "photo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "board_meeting_attendance" ADD CONSTRAINT "board_meeting_attendance_meeting_id_board_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."board_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meeting_attendance" ADD CONSTRAINT "board_meeting_attendance_board_member_id_board_members_id_fk" FOREIGN KEY ("board_member_id") REFERENCES "public"."board_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meeting_attendance" ADD CONSTRAINT "board_meeting_attendance_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_meetings" ADD CONSTRAINT "board_meetings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_minutes" ADD CONSTRAINT "board_minutes_meeting_id_board_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."board_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_minutes" ADD CONSTRAINT "board_minutes_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_minutes" ADD CONSTRAINT "board_minutes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_motions" ADD CONSTRAINT "board_motions_meeting_id_board_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."board_meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_motions" ADD CONSTRAINT "board_motions_moved_by_board_member_id_board_members_id_fk" FOREIGN KEY ("moved_by_board_member_id") REFERENCES "public"."board_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_motions" ADD CONSTRAINT "board_motions_seconded_by_board_member_id_board_members_id_fk" FOREIGN KEY ("seconded_by_board_member_id") REFERENCES "public"."board_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_motions" ADD CONSTRAINT "board_motions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_motion_id_board_motions_id_fk" FOREIGN KEY ("motion_id") REFERENCES "public"."board_motions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_board_member_id_board_members_id_fk" FOREIGN KEY ("board_member_id") REFERENCES "public"."board_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_votes" ADD CONSTRAINT "board_votes_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_attendance_unique_idx" ON "board_meeting_attendance" USING btree ("meeting_id","board_member_id");--> statement-breakpoint
CREATE INDEX "board_meetings_starts_idx" ON "board_meetings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "board_members_user_idx" ON "board_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_minutes_version_idx" ON "board_minutes" USING btree ("meeting_id","version");--> statement-breakpoint
CREATE INDEX "board_motions_meeting_idx" ON "board_motions" USING btree ("meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_votes_unique_idx" ON "board_votes" USING btree ("motion_id","board_member_id");--> statement-breakpoint
-- Immutability guards for legal records (defense in depth; the DAL never issues these writes).
CREATE OR REPLACE FUNCTION board_votes_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'board_votes rows are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER board_votes_no_update_delete BEFORE UPDATE OR DELETE ON "board_votes"
  FOR EACH ROW EXECUTE FUNCTION board_votes_immutable();--> statement-breakpoint
CREATE OR REPLACE FUNCTION board_minutes_approved_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN RAISE EXCEPTION 'approved board minutes cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'approved' AND (
       NEW.body IS DISTINCT FROM OLD.body OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id
  ) THEN
    RAISE EXCEPTION 'approved board minutes are immutable (only is_public may change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER board_minutes_approved_guard BEFORE UPDATE OR DELETE ON "board_minutes"
  FOR EACH ROW EXECUTE FUNCTION board_minutes_approved_immutable();
