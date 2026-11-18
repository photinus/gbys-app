import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orgSettings } from "@/db/schema";
import { currentInKindRateCents } from "@/lib/grant-rate";

/**
 * Shared contract (orchestrator). The settings worker extends this file with
 * board-only read/update functions; keep these two exports unchanged.
 */

export interface Branding {
  orgName: string;
  shortName: string;
  legalDesignation: string;
  ein: string | null;
  supportEmail: string | null;
  websiteUrl: string | null;
  /** `/brand/logo?v=<ms>` when a logo is uploaded, else null (use the built-in emblem). */
  logoUrl: string | null;
}

export const DEFAULT_BRANDING: Branding = {
  orgName: "Gold Beach Youth Sports",
  shortName: "GBYS",
  legalDesignation: "501(c)(3) nonprofit",
  ein: null,
  supportEmail: null,
  websiteUrl: null,
  logoUrl: null,
};

/**
 * Public, non-sensitive branding for every page (incl. signed-out ones).
 * Never throws: falls back to defaults if the DB is unreachable (e.g. during
 * `next build`). Cached per request.
 */
export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const [row] = await db
      .select({
        orgName: orgSettings.orgName,
        shortName: orgSettings.shortName,
        legalDesignation: orgSettings.legalDesignation,
        ein: orgSettings.ein,
        supportEmail: orgSettings.supportEmail,
        websiteUrl: orgSettings.websiteUrl,
        logoUpdatedAt: orgSettings.logoUpdatedAt,
        logoContentType: orgSettings.logoContentType,
      })
      .from(orgSettings)
      .where(eq(orgSettings.id, 1))
      .limit(1);
    if (!row) return DEFAULT_BRANDING;
    return {
      orgName: row.orgName,
      shortName: row.shortName,
      legalDesignation: row.legalDesignation,
      ein: row.ein,
      supportEmail: row.supportEmail,
      websiteUrl: row.websiteUrl,
      logoUrl:
        row.logoContentType && row.logoUpdatedAt ? `/brand/logo?v=${row.logoUpdatedAt.getTime()}` : null,
    };
  } catch {
    return DEFAULT_BRANDING;
  }
});

/**
 * In-kind hourly valuation for NEW ledger entries: org_settings value, else env
 * DEFAULT_IN_KIND_HOURLY_RATE_CENTS, else 3349. Existing rows keep their snapshot.
 */
export async function getInKindRateCents(): Promise<number> {
  const [row] = await db
    .select({ rate: orgSettings.inKindHourlyRateCents })
    .from(orgSettings)
    .where(eq(orgSettings.id, 1))
    .limit(1);
  return row?.rate ?? currentInKindRateCents();
}
