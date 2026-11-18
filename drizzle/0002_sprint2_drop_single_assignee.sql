ALTER TABLE "volunteer_shifts" DROP CONSTRAINT "volunteer_shifts_assigned_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "volunteer_shifts" DROP COLUMN "assigned_user_id";--> statement-breakpoint
ALTER TABLE "volunteer_shifts" DROP COLUMN "checked_in_at";