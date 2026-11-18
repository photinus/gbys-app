CREATE TYPE "public"."volunteer_role_assignment_status" AS ENUM('pending', 'active', 'declined', 'withdrawn', 'ended');--> statement-breakpoint
CREATE TYPE "public"."volunteer_role_period" AS ENUM('per_season', 'per_year');--> statement-breakpoint
CREATE TABLE "volunteer_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"season_id" uuid,
	"year" integer,
	"term_key" text NOT NULL,
	"status" "volunteer_role_assignment_status" DEFAULT 'pending' NOT NULL,
	"expected_minutes" integer,
	"signed_up_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signup_note" text,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" text,
	"decision_note" text,
	"ended_at" timestamp with time zone,
	"ended_by_user_id" text,
	"end_reason" text,
	"program_role_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vra_term_chk" CHECK (("volunteer_role_assignments"."season_id" is not null and "volunteer_role_assignments"."year" is null) or ("volunteer_role_assignments"."season_id" is null and "volunteer_role_assignments"."year" is not null))
);
--> statement-breakpoint
CREATE TABLE "volunteer_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"category" "volunteer_category" NOT NULL,
	"period" "volunteer_role_period" NOT NULL,
	"expected_minutes" integer NOT NULL,
	"slots" integer,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"grants_program_role" "program_role",
	"required_credential_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volunteer_roles_expected_chk" CHECK ("volunteer_roles"."expected_minutes" >= 0 and "volunteer_roles"."expected_minutes" <= 200000),
	CONSTRAINT "volunteer_roles_slots_chk" CHECK ("volunteer_roles"."slots" is null or "volunteer_roles"."slots" >= 1),
	CONSTRAINT "volunteer_roles_season_needs_program_chk" CHECK ("volunteer_roles"."period" <> 'per_season' or "volunteer_roles"."program_id" is not null),
	CONSTRAINT "volunteer_roles_grant_safety_chk" CHECK ("volunteer_roles"."grants_program_role" is null or ("volunteer_roles"."requires_approval" and "volunteer_roles"."program_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD COLUMN "volunteer_role_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "volunteer_role_assignments" ADD CONSTRAINT "volunteer_role_assignments_role_id_volunteer_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."volunteer_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_role_assignments" ADD CONSTRAINT "volunteer_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_role_assignments" ADD CONSTRAINT "volunteer_role_assignments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_role_assignments" ADD CONSTRAINT "volunteer_role_assignments_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_role_assignments" ADD CONSTRAINT "volunteer_role_assignments_ended_by_user_id_users_id_fk" FOREIGN KEY ("ended_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_roles" ADD CONSTRAINT "volunteer_roles_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volunteer_roles" ADD CONSTRAINT "volunteer_roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vra_role_idx" ON "volunteer_role_assignments" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "vra_user_idx" ON "volunteer_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vra_live_unique_idx" ON "volunteer_role_assignments" USING btree ("role_id","user_id","term_key") WHERE "volunteer_role_assignments"."status" in ('pending', 'active');--> statement-breakpoint
CREATE INDEX "volunteer_roles_program_idx" ON "volunteer_roles" USING btree ("program_id");--> statement-breakpoint
ALTER TABLE "volunteer_logs" ADD CONSTRAINT "volunteer_logs_volunteer_role_assignment_id_volunteer_role_assignments_id_fk" FOREIGN KEY ("volunteer_role_assignment_id") REFERENCES "public"."volunteer_role_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "volunteer_logs_role_assignment_idx" ON "volunteer_logs" USING btree ("volunteer_role_assignment_id");