import "server-only";
import { randomBytes } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { contactForms, programSites, programs, users, type SiteSection } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { sniffPhotoType } from "@/lib/image";
import { primaryOrigin } from "@/lib/site-hosts";
import {
  HERO_MAX_WIDTH,
  IMAGE_MAX_BYTES,
  LOGO_MAX_SIZE,
  contentSchema,
  sectionsSchema,
  validateAccent,
  validateDomain,
  validatePath,
  type ContentInput,
} from "@/lib/validation/program-sites";
import { DalError, isBoard, type SessionContext } from "./context";
import { canManageProgram } from "./permissions";

/**
 * Program home pages — editor / admin side.
 * Reads: getSiteEditor, getSiteSummary. Writes (all require canManageProgram; the custom
 * domain requires the board): saveSiteContent, saveSiteLook, saveSiteSections,
 * saveSiteAddress, saveCustomDomain, setSitePublished, uploadSiteImage, removeSiteImage.
 * The site row is created on first save (upsert). Every write audits; address / domain /
 * listing changes record before and after values.
 */

const forbidden = () => new DalError("FORBIDDEN", "You do not have permission to do that.");
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a write touched, so the caller can revalidate the affected public pages. */
export interface SiteWriteEffect {
  programSlug: string;
  /** Path slugs and domains whose public pages changed (old and new values). */
  pathSlugs: string[];
  domains: string[];
  /** Whether the main landing page (and dashboard suggestions) may have changed. */
  affectsMainSite: boolean;
  changed: string[];
}

function effect(
  program: { slug: string },
  before: { pathSlug: string | null; customDomain: string | null },
  after: { pathSlug: string | null; customDomain: string | null },
  changed: string[],
  affectsMainSite = false
): SiteWriteEffect {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    programSlug: program.slug,
    pathSlugs: uniq([before.pathSlug, after.pathSlug]),
    domains: uniq([before.customDomain, after.customDomain]),
    affectsMainSite,
    changed,
  };
}

function isUniqueViolation(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  if (e?.code === "23505" || e?.cause?.code === "23505") return e.constraint ?? e.cause?.constraint ?? "";
  return null;
}

type SiteRow = typeof programSites.$inferSelect;

async function loadProgram(ctx: SessionContext, programId: string, tx: DbOrTx = db) {
  if (!uuidRe.test(programId)) throw new DalError("NOT_FOUND", "Program not found.");
  const [p] = await tx
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      isActive: programs.isActive,
      listOnMainSite: programs.listOnMainSite,
    })
    .from(programs)
    .where(and(eq(programs.id, programId), isNull(programs.deletedAt)))
    .limit(1);
  if (!p) throw new DalError("NOT_FOUND", "Program not found.");
  if (!canManageProgram(ctx, p.id)) throw forbidden();
  if (!p.isActive && !isBoard(ctx)) throw new DalError("NOT_FOUND", "Program not found.");
  return p;
}

/** Create the row on first save, then lock it for the rest of the transaction. */
async function lockSite(tx: DbOrTx, programId: string): Promise<SiteRow> {
  await tx.insert(programSites).values({ programId }).onConflictDoNothing();
  const [row] = await tx.select().from(programSites).where(eq(programSites.programId, programId)).for("update").limit(1);
  return row;
}

const short = (v: unknown) => (typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : v ?? null);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface SiteSummary {
  exists: boolean;
  isPublished: boolean;
  pathSlug: string | null;
  customDomain: string | null;
  listOnMainSite: boolean;
}

/** Status for the program hub / board cards. canManageProgram required. */
export async function getSiteSummary(ctx: SessionContext, programId: string): Promise<SiteSummary> {
  const p = await loadProgram(ctx, programId);
  const [r] = await db
    .select({ isPublished: programSites.isPublished, pathSlug: programSites.pathSlug, customDomain: programSites.customDomain })
    .from(programSites)
    .where(eq(programSites.programId, programId))
    .limit(1);
  return {
    exists: !!r,
    isPublished: r?.isPublished ?? false,
    pathSlug: r?.pathSlug ?? null,
    customDomain: r?.customDomain ?? null,
    listOnMainSite: p.listOnMainSite,
  };
}

export interface SiteEditorData {
  program: { id: string; slug: string; name: string; isActive: boolean };
  /** Only the board may set the custom domain. */
  canSetDomain: boolean;
  exists: boolean;
  isPublished: boolean;
  pathSlug: string | null;
  customDomain: string | null;
  listOnMainSite: boolean;
  headline: string;
  tagline: string;
  about: string;
  accentColor: string;
  sections: SiteSection[];
  showOpenRegistrations: boolean;
  contactFormId: string | null;
  contactEmail: string;
  contactPhone: string;
  seoDescription: string;
  heroImageUrl: string | null;
  logoUrl: string | null;
  /** Active contact forms of THIS program. */
  contactForms: { id: string; slug: string; title: string }[];
  appOrigin: string;
  appHost: string;
  updatedAt: Date | null;
  updatedByName: string | null;
}

export async function getSiteEditor(ctx: SessionContext, programSlug: string): Promise<SiteEditorData> {
  const [p] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.slug, programSlug), isNull(programs.deletedAt)))
    .limit(1);
  if (!p) throw new DalError("NOT_FOUND", "Program not found.");
  const program = await loadProgram(ctx, p.id);

  const [r] = await db
    .select({ site: programSites, updatedByName: users.name })
    .from(programSites)
    .leftJoin(users, eq(users.id, programSites.updatedByUserId))
    .where(eq(programSites.programId, program.id))
    .limit(1);
  const forms = await db
    .select({ id: contactForms.id, slug: contactForms.slug, title: contactForms.title })
    .from(contactForms)
    .where(and(eq(contactForms.programId, program.id), eq(contactForms.isActive, true)))
    .orderBy(asc(contactForms.title));

  const s = r?.site;
  const origin = primaryOrigin();
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    // keep origin
  }
  return {
    program: { id: program.id, slug: program.slug, name: program.name, isActive: program.isActive },
    canSetDomain: isBoard(ctx),
    exists: !!s,
    isPublished: s?.isPublished ?? false,
    pathSlug: s?.pathSlug ?? null,
    customDomain: s?.customDomain ?? null,
    listOnMainSite: program.listOnMainSite,
    headline: s?.headline ?? "",
    tagline: s?.tagline ?? "",
    about: s?.about ?? "",
    accentColor: s?.accentColor ?? "#4f46e5",
    sections: s?.sections ?? [],
    showOpenRegistrations: s?.showOpenRegistrations ?? true,
    contactFormId: s?.contactFormId ?? null,
    contactEmail: s?.contactEmail ?? "",
    contactPhone: s?.contactPhone ?? "",
    seoDescription: s?.seoDescription ?? "",
    heroImageUrl: s?.heroImageUpdatedAt ? `/brand/program/${program.id}/hero?v=${s.heroImageUpdatedAt.getTime()}` : null,
    logoUrl: s?.logoUpdatedAt ? `/brand/program/${program.id}/logo?v=${s.logoUpdatedAt.getTime()}` : null,
    contactForms: forms,
    appOrigin: origin,
    appHost: host,
    updatedAt: s?.updatedAt ?? null,
    updatedByName: r?.updatedByName ?? null,
  };
}

/** Live availability hint for the path field. Never reveals which program owns a path. */
export async function checkPathAvailability(
  ctx: SessionContext,
  programId: string,
  rawPath: string
): Promise<{ status: "empty" | "available" | "yours" | "taken" | "invalid"; value: string | null; message: string }> {
  await loadProgram(ctx, programId);
  const v = validatePath(rawPath);
  if (!v.ok) return { status: "invalid", value: null, message: v.error };
  if (v.value === null) return { status: "empty", value: null, message: "No address set. Add one to publish." };
  const [hit] = await db
    .select({ programId: programSites.programId })
    .from(programSites)
    .where(eq(programSites.pathSlug, v.value))
    .limit(1);
  if (hit && hit.programId !== programId) {
    return { status: "taken", value: v.value, message: "That address is already taken. Try another." };
  }
  if (hit) return { status: "yours", value: v.value, message: "This is your current address." };
  return { status: "available", value: v.value, message: "Available." };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function saveSiteContent(
  ctx: SessionContext,
  programId: string,
  input: ContentInput
): Promise<SiteWriteEffect & { saved: ContentOut }> {
  const program = await loadProgram(ctx, programId);
  const data = contentSchema.parse(input);

  return db.transaction(async (tx) => {
    const old = await lockSite(tx, programId);
    if (data.contactFormId && data.contactFormId !== old.contactFormId) {
      const [f] = await tx
        .select({ id: contactForms.id, programId: contactForms.programId, isActive: contactForms.isActive })
        .from(contactForms)
        .where(eq(contactForms.id, data.contactFormId))
        .limit(1);
      if (!f || f.programId !== programId || !f.isActive) {
        throw new DalError("INVALID", "Choose one of this program's active contact forms.");
      }
    }
    const next = {
      headline: data.headline,
      tagline: data.tagline,
      about: data.about,
      showOpenRegistrations: data.showOpenRegistrations,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      contactFormId: data.contactFormId,
      seoDescription: data.seoDescription,
    };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      if ((old[k] ?? null) !== (next[k] ?? null)) changes[k] = { from: short(old[k]), to: short(next[k]) };
    }
    const changed = Object.keys(changes);
    if (changed.length > 0) {
      await tx.update(programSites).set({ ...next, updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "program_site.updated",
          targetType: "program_site",
          targetId: programId,
          metadata: { section: "content", fields: changed, changes },
        },
        tx
      );
    }
    return { ...effect(program, old, old, changed), saved: next };
  });
}
type ContentOut = {
  headline: string | null;
  tagline: string | null;
  about: string | null;
  showOpenRegistrations: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  contactFormId: string | null;
  seoDescription: string | null;
};

export async function saveSiteLook(
  ctx: SessionContext,
  programId: string,
  input: { accentColor: string }
): Promise<SiteWriteEffect & { accentColor: string }> {
  const program = await loadProgram(ctx, programId);
  const v = validateAccent(input.accentColor);
  if (!v.ok) throw new DalError("INVALID", v.error);

  return db.transaction(async (tx) => {
    const old = await lockSite(tx, programId);
    const changed: string[] = [];
    if (old.accentColor !== v.value) {
      changed.push("accentColor");
      await tx.update(programSites).set({ accentColor: v.value, updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "program_site.updated",
          targetType: "program_site",
          targetId: programId,
          metadata: { section: "look", fields: changed, changes: { accentColor: { from: old.accentColor, to: v.value } } },
        },
        tx
      );
    }
    return { ...effect(program, old, old, changed), accentColor: v.value };
  });
}

const newId = () => randomBytes(8).toString("hex");

export async function saveSiteSections(
  ctx: SessionContext,
  programId: string,
  input: unknown
): Promise<SiteWriteEffect & { sections: SiteSection[] }> {
  const program = await loadProgram(ctx, programId);
  const drafts = sectionsSchema.parse(input);

  return db.transaction(async (tx) => {
    const old = await lockSite(tx, programId);
    const known = new Set((old.sections ?? []).map((s) => s.id));
    const used = new Set<string>();
    // Ids are server-generated. A client-supplied id survives only if it already exists on this page.
    const sections: SiteSection[] = drafts.map((d) => {
      let id = d.id && known.has(d.id) && !used.has(d.id) ? d.id : newId();
      while (used.has(id)) id = newId();
      used.add(id);
      return { ...d, id } as SiteSection;
    });
    const changed: string[] = [];
    if (JSON.stringify(old.sections ?? []) !== JSON.stringify(sections)) {
      changed.push("sections");
      await tx.update(programSites).set({ sections, updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "program_site.updated",
          targetType: "program_site",
          targetId: programId,
          metadata: {
            section: "sections",
            fields: changed,
            changes: {
              sections: {
                from: { count: (old.sections ?? []).length, titles: (old.sections ?? []).map((s) => s.title) },
                to: { count: sections.length, titles: sections.map((s) => s.title) },
              },
            },
          },
        },
        tx
      );
    }
    return { ...effect(program, old, old, changed), sections };
  });
}

/** Path + "list on main site". Program admins and the board. */
export async function saveSiteAddress(
  ctx: SessionContext,
  programId: string,
  input: { pathSlug: string; listOnMainSite: boolean }
): Promise<SiteWriteEffect & { pathSlug: string | null; listOnMainSite: boolean }> {
  const program = await loadProgram(ctx, programId);
  const path = validatePath(input.pathSlug ?? "");
  if (!path.ok) throw new DalError("INVALID", path.error);
  const listOnMainSite = !!input.listOnMainSite;

  try {
    return await db.transaction(async (tx) => {
      const old = await lockSite(tx, programId);
      const changed: string[] = [];

      if (path.value !== old.pathSlug) {
        if (path.value) {
          const [hit] = await tx
            .select({ programId: programSites.programId })
            .from(programSites)
            .where(and(eq(programSites.pathSlug, path.value), ne(programSites.programId, programId)))
            .limit(1);
          if (hit) throw new DalError("INVALID", "That address is already taken by another home page. Please choose a different one.");
        }
        if (!path.value && old.isPublished && !old.customDomain) {
          throw new DalError("INVALID", "A published page needs an address. Unpublish it first, or set an address instead of clearing it.");
        }
        changed.push("pathSlug");
        await tx.update(programSites).set({ pathSlug: path.value, updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
        await writeAudit(
          {
            actorUserId: ctx.userId,
            action: "program_site.address_updated",
            targetType: "program_site",
            targetId: programId,
            metadata: { pathSlug: { from: old.pathSlug, to: path.value } },
          },
          tx
        );
      }

      let listingChanged = false;
      if (listOnMainSite !== program.listOnMainSite) {
        listingChanged = true;
        changed.push("listOnMainSite");
        await tx.update(programs).set({ listOnMainSite }).where(eq(programs.id, programId));
        await writeAudit(
          {
            actorUserId: ctx.userId,
            action: "program.listing_updated",
            targetType: "program",
            targetId: programId,
            metadata: { listOnMainSite: { from: program.listOnMainSite, to: listOnMainSite } },
          },
          tx
        );
      }
      if (changed.length > 0) {
        await tx.update(programSites).set({ updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
      }
      return {
        ...effect(program, old, { pathSlug: path.value, customDomain: old.customDomain }, changed, listingChanged),
        pathSlug: path.value,
        listOnMainSite,
      };
    });
  } catch (err) {
    if (isUniqueViolation(err) !== null) {
      throw new DalError("INVALID", "That address is already taken by another home page. Please choose a different one.");
    }
    throw err;
  }
}

/** Custom domain: board only. */
export async function saveCustomDomain(
  ctx: SessionContext,
  programId: string,
  input: { customDomain: string }
): Promise<SiteWriteEffect & { customDomain: string | null }> {
  if (!isBoard(ctx)) throw forbidden();
  const program = await loadProgram(ctx, programId);
  const dom = validateDomain(input.customDomain ?? "");
  if (!dom.ok) throw new DalError("INVALID", dom.error);

  try {
    return await db.transaction(async (tx) => {
      const old = await lockSite(tx, programId);
      const changed: string[] = [];
      if (dom.value !== old.customDomain) {
        if (dom.value) {
          const [hit] = await tx
            .select({ programId: programSites.programId })
            .from(programSites)
            .where(and(eq(programSites.customDomain, dom.value), ne(programSites.programId, programId)))
            .limit(1);
          if (hit) throw new DalError("INVALID", "That domain is already connected to another program's home page.");
        }
        if (!dom.value && old.isPublished && !old.pathSlug) {
          throw new DalError("INVALID", "A published page needs an address. Unpublish it first, or give it a path on the GBYS site.");
        }
        changed.push("customDomain");
        await tx.update(programSites).set({ customDomain: dom.value, updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
        await writeAudit(
          {
            actorUserId: ctx.userId,
            action: "program_site.address_updated",
            targetType: "program_site",
            targetId: programId,
            metadata: { customDomain: { from: old.customDomain, to: dom.value } },
          },
          tx
        );
      }
      return { ...effect(program, old, { pathSlug: old.pathSlug, customDomain: dom.value }, changed), customDomain: dom.value };
    });
  } catch (err) {
    if (isUniqueViolation(err) !== null) {
      throw new DalError("INVALID", "That domain is already connected to another program's home page.");
    }
    throw err;
  }
}

export async function setSitePublished(
  ctx: SessionContext,
  programId: string,
  published: boolean
): Promise<SiteWriteEffect & { isPublished: boolean }> {
  const program = await loadProgram(ctx, programId);
  return db.transaction(async (tx) => {
    const old = await lockSite(tx, programId);
    const changed: string[] = [];
    if (published && !old.pathSlug && !old.customDomain) {
      throw new DalError(
        "INVALID",
        "Set an address before publishing: a path on the GBYS site (like /basketball) or a custom domain."
      );
    }
    if (old.isPublished !== published) {
      changed.push("isPublished");
      await tx.update(programSites).set({ isPublished: published, updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: published ? "program_site.published" : "program_site.unpublished",
          targetType: "program_site",
          targetId: programId,
          metadata: { pathSlug: old.pathSlug, customDomain: old.customDomain },
        },
        tx
      );
    }
    return { ...effect(program, old, old, changed), isPublished: published };
  });
}

// ---- Images ------------------------------------------------------------------------------------

export type SiteImageKind = "hero" | "logo";

export async function uploadSiteImage(
  ctx: SessionContext,
  programId: string,
  kind: SiteImageKind,
  file: unknown
): Promise<SiteWriteEffect & { url: string }> {
  if (kind !== "hero" && kind !== "logo") throw new DalError("INVALID", "Unknown image type.");
  const program = await loadProgram(ctx, programId);
  if (!(file instanceof File) || file.size === 0) throw new DalError("INVALID", "Choose an image file to upload.");
  if (file.size > IMAGE_MAX_BYTES) throw new DalError("INVALID", "Images must be 5 MB or smaller.");
  const input = Buffer.from(await file.arrayBuffer());
  if (input.length > IMAGE_MAX_BYTES) throw new DalError("INVALID", "Images must be 5 MB or smaller.");
  // Never trust the declared type or extension. PNG, JPEG and WebP only (no SVG, GIF, HEIC).
  const type = sniffPhotoType(input);
  if (type !== "image/png" && type !== "image/jpeg" && type !== "image/webp") {
    throw new DalError("INVALID", "Use a PNG, JPEG or WebP image. (SVG, GIF and other formats aren't accepted.)");
  }

  let out: Buffer;
  let info: OutputInfo;
  try {
    const img = sharp(input, { failOn: "error", limitInputPixels: 50_000_000 }).rotate(); // rotate() applies EXIF; metadata is dropped on output
    const resized =
      kind === "hero"
        ? img.resize({ width: HERO_MAX_WIDTH, withoutEnlargement: true })
        : img.resize({ width: LOGO_MAX_SIZE, height: LOGO_MAX_SIZE, fit: "inside", withoutEnlargement: true });
    const res = await resized.webp({ quality: kind === "hero" ? 80 : 88 }).toBuffer({ resolveWithObject: true });
    out = res.data;
    info = res.info;
  } catch {
    throw new DalError("INVALID", "That image couldn't be read. Try a different file.");
  }

  const now = new Date();
  return db.transaction(async (tx) => {
    const old = await lockSite(tx, programId);
    const set =
      kind === "hero"
        ? { heroImage: out, heroImageContentType: "image/webp", heroImageUpdatedAt: now }
        : { logo: out, logoContentType: "image/webp", logoUpdatedAt: now };
    await tx.update(programSites).set({ ...set, updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "program_site.image_updated",
        targetType: "program_site",
        targetId: programId,
        metadata: { kind, uploadedType: type, bytesIn: input.length, bytesOut: out.length, width: info.width, height: info.height },
      },
      tx
    );
    return { ...effect(program, old, old, [kind]), url: `/brand/program/${programId}/${kind}?v=${now.getTime()}` };
  });
}

export async function removeSiteImage(ctx: SessionContext, programId: string, kind: SiteImageKind): Promise<SiteWriteEffect> {
  if (kind !== "hero" && kind !== "logo") throw new DalError("INVALID", "Unknown image type.");
  const program = await loadProgram(ctx, programId);
  return db.transaction(async (tx) => {
    const old = await lockSite(tx, programId);
    const had = kind === "hero" ? !!old.heroImageUpdatedAt : !!old.logoUpdatedAt;
    if (!had) return effect(program, old, old, []);
    const set =
      kind === "hero"
        ? { heroImage: null, heroImageContentType: null, heroImageUpdatedAt: null }
        : { logo: null, logoContentType: null, logoUpdatedAt: null };
    await tx.update(programSites).set({ ...set, updatedByUserId: ctx.userId }).where(eq(programSites.programId, programId));
    await writeAudit(
      { actorUserId: ctx.userId, action: "program_site.image_removed", targetType: "program_site", targetId: programId, metadata: { kind } },
      tx
    );
    return effect(program, old, old, [kind]);
  });
}
