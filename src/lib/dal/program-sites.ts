import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contactForms, programSites, programs, type SiteSection } from "@/db/schema";
import { DalError, type SessionContext } from "./context";
import { canManageProgram } from "./permissions";

/**
 * Program home pages — read side (orchestrator contract). Public reads return only
 * PUBLISHED sites of ACTIVE programs. Writes live in program-sites-admin.ts.
 */

export interface PublicProgramSite {
  program: { id: string; slug: string; name: string; sport: string; description: string | null; listOnMainSite: boolean };
  isPublished: boolean;
  pathSlug: string | null;
  customDomain: string | null;
  headline: string;
  tagline: string | null;
  about: string | null;
  accentColor: string;
  sections: SiteSection[];
  showOpenRegistrations: boolean;
  contactForm: { slug: string; title: string } | null;
  contactEmail: string | null;
  contactPhone: string | null;
  seoDescription: string | null;
  heroImageUrl: string | null;
  logoUrl: string | null;
  updatedAt: Date;
}

const cols = {
  programId: programs.id,
  programSlug: programs.slug,
  programName: programs.name,
  sport: programs.sport,
  description: programs.description,
  listOnMainSite: programs.listOnMainSite,
  isPublished: programSites.isPublished,
  pathSlug: programSites.pathSlug,
  customDomain: programSites.customDomain,
  headline: programSites.headline,
  tagline: programSites.tagline,
  about: programSites.about,
  accentColor: programSites.accentColor,
  sections: programSites.sections,
  showOpenRegistrations: programSites.showOpenRegistrations,
  contactFormSlug: contactForms.slug,
  contactFormTitle: contactForms.title,
  contactFormActive: contactForms.isActive,
  contactEmail: programSites.contactEmail,
  contactPhone: programSites.contactPhone,
  seoDescription: programSites.seoDescription,
  heroImageUpdatedAt: programSites.heroImageUpdatedAt,
  logoUpdatedAt: programSites.logoUpdatedAt,
  updatedAt: programSites.updatedAt,
};

type Row = {
  [K in keyof typeof cols]: (typeof cols)[K]["_"]["notNull"] extends true
    ? (typeof cols)[K]["_"]["data"]
    : (typeof cols)[K]["_"]["data"] | null;
};

function toSite(r: Row): PublicProgramSite {
  return {
    program: {
      id: r.programId,
      slug: r.programSlug,
      name: r.programName,
      sport: r.sport,
      description: r.description,
      listOnMainSite: r.listOnMainSite,
    },
    isPublished: r.isPublished,
    pathSlug: r.pathSlug,
    customDomain: r.customDomain,
    headline: r.headline?.trim() || r.programName,
    tagline: r.tagline,
    about: r.about,
    accentColor: r.accentColor,
    sections: r.sections ?? [],
    showOpenRegistrations: r.showOpenRegistrations,
    contactForm: r.contactFormSlug && r.contactFormActive ? { slug: r.contactFormSlug, title: r.contactFormTitle ?? "Contact us" } : null,
    contactEmail: r.contactEmail,
    contactPhone: r.contactPhone,
    seoDescription: r.seoDescription,
    heroImageUrl: r.heroImageUpdatedAt ? `/brand/program/${r.programId}/hero?v=${r.heroImageUpdatedAt.getTime()}` : null,
    logoUrl: r.logoUpdatedAt ? `/brand/program/${r.programId}/logo?v=${r.logoUpdatedAt.getTime()}` : null,
    updatedAt: r.updatedAt,
  };
}

function base() {
  return db
    .select(cols)
    .from(programSites)
    .innerJoin(programs, eq(programs.id, programSites.programId))
    .leftJoin(contactForms, eq(contactForms.id, programSites.contactFormId));
}

const liveProgram = and(eq(programs.isActive, true), isNull(programs.deletedAt));

/** Published site at https://<app>/<pathSlug>. */
export async function getPublishedSiteByPath(pathSlug: string): Promise<PublicProgramSite | null> {
  const slug = pathSlug.toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const [r] = await base()
    .where(and(eq(programSites.pathSlug, slug), eq(programSites.isPublished, true), liveProgram))
    .limit(1);
  return r ? toSite(r as Row) : null;
}

/** Published site for a custom domain (already normalized by normalizeHost). */
export async function getPublishedSiteByDomain(host: string): Promise<PublicProgramSite | null> {
  if (!/^[a-z0-9.-]{1,253}$/.test(host)) return null;
  const [r] = await base()
    .where(and(eq(programSites.customDomain, host), eq(programSites.isPublished, true), liveProgram))
    .limit(1);
  return r ? toSite(r as Row) : null;
}

/**
 * Preview (published or not) for program admins and the board, by program slug.
 * Returns null when the program has no site row yet.
 */
export async function getSiteForPreview(ctx: SessionContext, programSlug: string): Promise<PublicProgramSite | null> {
  const [p] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.slug, programSlug), isNull(programs.deletedAt)))
    .limit(1);
  if (!p || !canManageProgram(ctx, p.id)) throw new DalError("NOT_FOUND", "Program not found.");
  const [r] = await base().where(eq(programSites.programId, p.id)).limit(1);
  return r ? toSite(r as Row) : null;
}

/**
 * Image bytes for /brand/program/<programId>/{hero,logo}. Served for unpublished sites too
 * (admin preview); program ids are unguessable and images are public branding by nature.
 */
export async function getSiteImage(
  programId: string,
  kind: "hero" | "logo"
): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(programId)) return null;
  const [r] = await db
    .select({
      hero: programSites.heroImage,
      heroType: programSites.heroImageContentType,
      logo: programSites.logo,
      logoType: programSites.logoContentType,
    })
    .from(programSites)
    .where(eq(programSites.programId, programId))
    .limit(1);
  if (!r) return null;
  const bytes = kind === "hero" ? r.hero : r.logo;
  const type = kind === "hero" ? r.heroType : r.logoType;
  return bytes && type ? { bytes, contentType: type } : null;
}
