import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orgSettings, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { currentInKindRateCents } from "@/lib/grant-rate";
import {
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  updateSettingsSchema,
  type LogoType,
  type UpdateSettingsInput,
} from "@/lib/validation/settings";
import { DalError, isBoard, type SessionContext } from "./context";

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

// ---------------------------------------------------------------------------
// Board-only settings administration (Admin & settings sprint, WS)
// ---------------------------------------------------------------------------

export interface OrgSettingsView {
  orgName: string;
  shortName: string;
  legalDesignation: string;
  ein: string | null;
  supportEmail: string | null;
  websiteUrl: string | null;
  /** Stored override in cents (null = use the default). */
  inKindHourlyRateCents: number | null;
  inKindRateSource: string | null;
  /** The environment/built-in default used when no override is stored. */
  defaultRateCents: number;
  /** What new ledger entries will snapshot right now. */
  effectiveRateCents: number;
  logoUrl: string | null;
  logoContentType: string | null;
  logoUpdatedAt: Date | null;
  updatedAt: Date | null;
  updatedByName: string | null;
}

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

export async function getOrgSettings(ctx: SessionContext): Promise<OrgSettingsView> {
  requireBoard(ctx);
  const [row] = await db
    .select({
      orgName: orgSettings.orgName,
      shortName: orgSettings.shortName,
      legalDesignation: orgSettings.legalDesignation,
      ein: orgSettings.ein,
      supportEmail: orgSettings.supportEmail,
      websiteUrl: orgSettings.websiteUrl,
      rate: orgSettings.inKindHourlyRateCents,
      rateSource: orgSettings.inKindRateSource,
      logoContentType: orgSettings.logoContentType,
      logoUpdatedAt: orgSettings.logoUpdatedAt,
      updatedAt: orgSettings.updatedAt,
      updatedByName: users.name,
    })
    .from(orgSettings)
    .leftJoin(users, eq(users.id, orgSettings.updatedByUserId))
    .where(eq(orgSettings.id, 1))
    .limit(1);
  const defaultRateCents = currentInKindRateCents();
  if (!row) {
    return {
      ...DEFAULT_BRANDING,
      inKindHourlyRateCents: null,
      inKindRateSource: null,
      defaultRateCents,
      effectiveRateCents: defaultRateCents,
      logoContentType: null,
      logoUpdatedAt: null,
      updatedAt: null,
      updatedByName: null,
    };
  }
  return {
    orgName: row.orgName,
    shortName: row.shortName,
    legalDesignation: row.legalDesignation,
    ein: row.ein,
    supportEmail: row.supportEmail,
    websiteUrl: row.websiteUrl,
    inKindHourlyRateCents: row.rate,
    inKindRateSource: row.rateSource,
    defaultRateCents,
    effectiveRateCents: row.rate ?? defaultRateCents,
    logoUrl: row.logoContentType && row.logoUpdatedAt ? `/brand/logo?v=${row.logoUpdatedAt.getTime()}` : null,
    logoContentType: row.logoContentType,
    logoUpdatedAt: row.logoUpdatedAt,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedByName,
  };
}

const PROFILE_FIELDS = ["orgName", "shortName", "legalDesignation", "ein", "supportEmail", "websiteUrl"] as const;

export async function updateOrgSettings(
  ctx: SessionContext,
  input: UpdateSettingsInput
): Promise<{ changed: string[] }> {
  requireBoard(ctx);
  const data = updateSettingsSchema.parse(input);

  return db.transaction(async (tx) => {
    await tx.insert(orgSettings).values({ id: 1 }).onConflictDoNothing();
    const [old] = await tx.select().from(orgSettings).where(eq(orgSettings.id, 1)).for("update").limit(1);

    const changed: string[] = [];
    const set: Partial<typeof orgSettings.$inferInsert> = {};
    const metadata: Record<string, unknown> = {};
    if (data.section === "profile") {
      for (const f of PROFILE_FIELDS) if ((old[f] ?? null) !== (data[f] ?? null)) changed.push(f);
      if (changed.length === 0) return { changed };
      Object.assign(set, {
        orgName: data.orgName,
        shortName: data.shortName,
        legalDesignation: data.legalDesignation,
        ein: data.ein,
        supportEmail: data.supportEmail,
        websiteUrl: data.websiteUrl,
      });
    } else {
      const rateChanged = (old.inKindHourlyRateCents ?? null) !== data.inKindRateDollars;
      if (rateChanged) changed.push("inKindHourlyRateCents");
      if ((old.inKindRateSource ?? null) !== data.inKindRateSource) changed.push("inKindRateSource");
      if (changed.length === 0) return { changed };
      Object.assign(set, { inKindHourlyRateCents: data.inKindRateDollars, inKindRateSource: data.inKindRateSource });
      if (rateChanged) {
        metadata.inKindHourlyRateCents = { from: old.inKindHourlyRateCents ?? null, to: data.inKindRateDollars };
      }
    }

    await tx
      .update(orgSettings)
      .set({ ...set, updatedByUserId: ctx.userId })
      .where(eq(orgSettings.id, 1));

    metadata.fields = changed;
    await writeAudit(
      { actorUserId: ctx.userId, action: "settings.updated", targetType: "org_settings", targetId: "1", metadata },
      tx
    );
    return { changed };
  });
}

/** Identify an image by its leading bytes. Never trusts the declared type or file name. */
export function sniffImageType(buf: Uint8Array): LogoType | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export async function uploadLogo(ctx: SessionContext, formData: FormData): Promise<{ contentType: LogoType; bytes: number }> {
  requireBoard(ctx);
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) throw new DalError("INVALID", "Choose an image file to upload.");
  if (file.size > LOGO_MAX_BYTES) throw new DalError("INVALID", "Logo must be 512 KB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > LOGO_MAX_BYTES) throw new DalError("INVALID", "Logo must be 512 KB or smaller.");
  const type = sniffImageType(bytes);
  if (!type) throw new DalError("INVALID", "Logo must be a PNG, JPEG or WebP image (SVG is not allowed).");

  await db.transaction(async (tx) => {
    await tx.insert(orgSettings).values({ id: 1 }).onConflictDoNothing();
    await tx
      .update(orgSettings)
      .set({ logo: Buffer.from(bytes), logoContentType: type, logoUpdatedAt: new Date(), updatedByUserId: ctx.userId })
      .where(eq(orgSettings.id, 1));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "branding.logo_updated",
        targetType: "org_settings",
        targetId: "1",
        metadata: { contentType: type, bytes: bytes.length },
      },
      tx
    );
  });
  return { contentType: type, bytes: bytes.length };
}

export async function removeLogo(ctx: SessionContext): Promise<void> {
  requireBoard(ctx);
  await db.transaction(async (tx) => {
    await tx
      .update(orgSettings)
      .set({ logo: null, logoContentType: null, logoUpdatedAt: null, updatedByUserId: ctx.userId })
      .where(eq(orgSettings.id, 1));
    await writeAudit(
      { actorUserId: ctx.userId, action: "branding.logo_removed", targetType: "org_settings", targetId: "1" },
      tx
    );
  });
}

/** Public logo bytes for GET /brand/logo. Null when no logo is stored. */
export async function getLogoBytes(): Promise<{ bytes: Buffer; contentType: LogoType } | null> {
  const [row] = await db
    .select({ logo: orgSettings.logo, type: orgSettings.logoContentType })
    .from(orgSettings)
    .where(eq(orgSettings.id, 1))
    .limit(1);
  if (!row?.logo || !row.type) return null;
  const type = row.type as LogoType;
  if (!LOGO_TYPES.includes(type)) return null;
  return { bytes: row.logo, contentType: type };
}
