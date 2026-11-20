import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, jsonb, uuid, uniqueIndex, check, customType } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { programs } from "./programs";
import { contactForms } from "./contact";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** A configurable block on a program home page (plain text only — rendered escaped, URLs auto-linked). */
export type SiteSection =
  | { id: string; kind: "text"; title: string; body: string }
  | { id: string; kind: "faq"; title: string; items: { q: string; a: string }[] }
  | { id: string; kind: "links"; title: string; items: { label: string; url: string }[] };

/**
 * Public program home page (one per program). Reachable when `isPublished` at
 *   - https://<primary app host>/<pathSlug>         (e.g. /basketball-registration)
 *   - https://<customDomain>/                       (middleware rewrites "/" to /sites/domain/<host>)
 * Program admins edit content/theme/path; the board sets the custom domain.
 * Images live in Postgres (sniffed png/jpeg/webp, re-encoded webp; never SVG) and are
 * served publicly by /brand/program/<programId>/{hero,logo}?v=<updatedAt>.
 */
export const programSites = pgTable(
  "program_sites",
  {
    programId: uuid("program_id")
      .primaryKey()
      .references(() => programs.id),
    isPublished: boolean("is_published").notNull().default(false),
    pathSlug: text("path_slug"), // lowercase [a-z0-9-], not a reserved app route
    customDomain: text("custom_domain"), // lowercase hostname, no scheme/port
    headline: text("headline"), // defaults to program name
    tagline: text("tagline"),
    about: text("about"), // plain text, paragraphs separated by blank lines
    accentColor: text("accent_color").notNull().default("#4f46e5"), // #rrggbb
    sections: jsonb("sections").$type<SiteSection[]>().notNull().default([]),
    showOpenRegistrations: boolean("show_open_registrations").notNull().default(true),
    contactFormId: uuid("contact_form_id").references(() => contactForms.id),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    seoDescription: text("seo_description"),
    heroImage: bytea("hero_image"),
    heroImageContentType: text("hero_image_content_type"),
    heroImageUpdatedAt: timestamp("hero_image_updated_at", { withTimezone: true }),
    logo: bytea("logo"),
    logoContentType: text("logo_content_type"),
    logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    updatedByUserId: text("updated_by_user_id").references(() => users.id),
  },
  (t) => [
    uniqueIndex("program_sites_path_idx").on(t.pathSlug).where(sql`${t.pathSlug} is not null`),
    uniqueIndex("program_sites_domain_idx").on(t.customDomain).where(sql`${t.customDomain} is not null`),
    check("program_sites_path_chk", sql`${t.pathSlug} is null or ${t.pathSlug} ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'`),
    check("program_sites_accent_chk", sql`${t.accentColor} ~ '^#[0-9a-f]{6}$'`),
  ]
);
