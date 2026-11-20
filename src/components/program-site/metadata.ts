import type { Metadata } from "next";
import type { PublicProgramSite } from "@/lib/dal/program-sites";
import { primaryOrigin } from "@/lib/site-hosts";
import { plainExcerpt } from "@/lib/site-text";

/** Canonical public URL: the custom domain if set, else <primary origin>/<pathSlug>. */
export function canonicalFor(site: Pick<PublicProgramSite, "customDomain" | "pathSlug">): string | null {
  if (site.customDomain) return `https://${site.customDomain}/`;
  if (site.pathSlug) return `${primaryOrigin()}/${site.pathSlug}`;
  return null;
}

/** Origin that serves the site's own images in absolute form (OG image). */
function imageOrigin(site: Pick<PublicProgramSite, "customDomain">): string {
  return site.customDomain ? `https://${site.customDomain}` : primaryOrigin();
}

export function siteMetadata(site: PublicProgramSite): Metadata {
  const title = site.headline === site.program.name ? site.headline : `${site.headline} · ${site.program.name}`;
  const description = plainExcerpt(site.seoDescription || site.tagline || site.program.description, 300) || undefined;
  const canonical = canonicalFor(site);
  const image = site.heroImageUrl ? `${imageOrigin(site)}${site.heroImageUrl}` : site.logoUrl ? `${imageOrigin(site)}${site.logoUrl}` : null;
  return {
    title: { absolute: title },
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: {
      type: "website",
      title,
      description,
      ...(canonical ? { url: canonical } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, ...(image ? { images: [image] } : {}) },
  };
}
