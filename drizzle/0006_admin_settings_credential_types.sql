CREATE TABLE "org_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"org_name" text DEFAULT 'Gold Beach Youth Sports' NOT NULL,
	"short_name" text DEFAULT 'GBYS' NOT NULL,
	"legal_designation" text DEFAULT '501(c)(3) nonprofit' NOT NULL,
	"ein" text,
	"support_email" text,
	"website_url" text,
	"in_kind_hourly_rate_cents" integer,
	"in_kind_rate_source" text,
	"logo" "bytea",
	"logo_content_type" text,
	"logo_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" text,
	CONSTRAINT "org_settings_singleton_chk" CHECK ("org_settings"."id" = 1),
	CONSTRAINT "org_settings_rate_chk" CHECK ("org_settings"."in_kind_hourly_rate_cents" is null or "org_settings"."in_kind_hourly_rate_cents" between 100 and 50000)
);
--> statement-breakpoint
ALTER TABLE "credential_definitions" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_definitions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_definitions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "org_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
