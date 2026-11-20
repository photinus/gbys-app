CREATE TABLE "program_sites" (
	"program_id" uuid PRIMARY KEY NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"path_slug" text,
	"custom_domain" text,
	"headline" text,
	"tagline" text,
	"about" text,
	"accent_color" text DEFAULT '#4f46e5' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"show_open_registrations" boolean DEFAULT true NOT NULL,
	"contact_form_id" uuid,
	"contact_email" text,
	"contact_phone" text,
	"seo_description" text,
	"hero_image" "bytea",
	"hero_image_content_type" text,
	"hero_image_updated_at" timestamp with time zone,
	"logo" "bytea",
	"logo_content_type" text,
	"logo_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	CONSTRAINT "program_sites_path_chk" CHECK ("program_sites"."path_slug" is null or "program_sites"."path_slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
	CONSTRAINT "program_sites_accent_chk" CHECK ("program_sites"."accent_color" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "programs" ADD COLUMN "list_on_main_site" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "program_sites" ADD CONSTRAINT "program_sites_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_sites" ADD CONSTRAINT "program_sites_contact_form_id_contact_forms_id_fk" FOREIGN KEY ("contact_form_id") REFERENCES "public"."contact_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_sites" ADD CONSTRAINT "program_sites_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "program_sites_path_idx" ON "program_sites" USING btree ("path_slug") WHERE "program_sites"."path_slug" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "program_sites_domain_idx" ON "program_sites" USING btree ("custom_domain") WHERE "program_sites"."custom_domain" is not null;