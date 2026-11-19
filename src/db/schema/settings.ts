import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, check, customType, jsonb } from "drizzle-orm/pg-core";
import { users } from "./auth";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Singleton organisation settings (row id = 1). Branding is public (shown on
 * sign-in and landing pages); everything else is board-managed.
 * The logo lives in Postgres (<= 512 KB, png/jpeg/webp only; never SVG) so it
 * can be served publicly at /brand/logo without exposing the private S3 bucket.
 */
export const orgSettings = pgTable(
  "org_settings",
  {
    id: integer("id").primaryKey().default(1),
    orgName: text("org_name").notNull().default("Gold Beach Youth Sports"),
    shortName: text("short_name").notNull().default("GBYS"),
    legalDesignation: text("legal_designation").notNull().default("501(c)(3) nonprofit"),
    ein: text("ein"),
    supportEmail: text("support_email"),
    websiteUrl: text("website_url"),
    // Null = fall back to env DEFAULT_IN_KIND_HOURLY_RATE_CENTS (then 3349).
    inKindHourlyRateCents: integer("in_kind_hourly_rate_cents"),
    inKindRateSource: text("in_kind_rate_source"), // e.g. "Independent Sector 2025, Oregon"
    // Ordered list of Board of Directors position titles offered in the seat form
    // (roster sorts by this order). Seats store the title as text, so editing this
    // list never rewrites existing seats.
    boardPositions: jsonb("board_positions")
      .$type<string[]>()
      .notNull()
      .default(["President", "Vice President", "Secretary", "Treasurer", "Director"]),
    logo: bytea("logo"),
    logoContentType: text("logo_content_type"),
    logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
  },
  (t) => [
    check("org_settings_singleton_chk", sql`${t.id} = 1`),
    check(
      "org_settings_rate_chk",
      sql`${t.inKindHourlyRateCents} is null or ${t.inKindHourlyRateCents} between 100 and 50000`
    ),
  ]
);
