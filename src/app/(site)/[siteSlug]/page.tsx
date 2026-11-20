import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { siteMetadata } from "@/components/program-site/metadata";
import { ProgramSitePage } from "@/components/program-site/program-site-page";
import { getPublishedSiteByPath } from "@/lib/dal/program-sites";
import { listOpenSeasonsForProgram } from "@/lib/dal/registrations";
import { getBranding } from "@/lib/dal/settings";

export const dynamic = "force-dynamic";

type Params = Promise<{ siteSlug: string }>;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const site = await getPublishedSiteByPath(decode((await params).siteSlug));
  return site ? siteMetadata(site) : { title: "Page not found" };
}

/** Public program home page at <app>/<pathSlug>. 404 unless published. */
export default async function ProgramSitePathPage({ params }: { params: Params }) {
  const slug = decode((await params).siteSlug);
  const site = await getPublishedSiteByPath(slug); // case-insensitive
  if (!site) notFound();
  if (slug !== slug.toLowerCase()) redirect(`/${slug.toLowerCase()}`);

  const [seasons, { orgName }] = await Promise.all([
    site.showOpenRegistrations ? listOpenSeasonsForProgram(site.program.id) : Promise.resolve([]),
    getBranding(),
  ]);
  return <ProgramSitePage site={site} seasons={seasons} orgName={orgName} />;
}
