import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { siteMetadata } from "@/components/program-site/metadata";
import { ProgramSitePage } from "@/components/program-site/program-site-page";
import { getPublishedSiteByDomain } from "@/lib/dal/program-sites";
import { listOpenSeasonsForProgram } from "@/lib/dal/registrations";
import { getBranding } from "@/lib/dal/settings";
import { normalizeHost, primaryOrigin } from "@/lib/site-hosts";

export const dynamic = "force-dynamic";

type Params = Promise<{ host: string }>;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The host param is trusted only when it equals the request's own Host (middleware rewrote it). */
async function resolveHost(params: Params): Promise<{ param: string; matches: boolean }> {
  const param = normalizeHost(decode((await params).host));
  const requestHost = normalizeHost((await headers()).get("host"));
  return { param, matches: !!param && param === requestHost };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { param, matches } = await resolveHost(params);
  if (!matches) return { title: "Redirecting", robots: { index: false } };
  const site = await getPublishedSiteByDomain(param);
  return site ? siteMetadata(site) : { title: "Not found", robots: { index: false } };
}

/**
 * Program home page on a custom domain (middleware rewrites "/" here). Refuses to render
 * unless the request's Host IS the [host] param, so /sites/domain/<x> on the app domain
 * (or any other host) cannot be used to show a program's page under the wrong origin.
 */
export default async function ProgramSiteDomainPage({ params }: { params: Params }) {
  const { param, matches } = await resolveHost(params);
  const site = param ? await getPublishedSiteByDomain(param) : null;
  if (!site) redirect(primaryOrigin());
  if (!matches) redirect(`https://${param}/`); // canonical URL of this site; never render here

  const [seasons, { orgName }] = await Promise.all([
    site.showOpenRegistrations ? listOpenSeasonsForProgram(site.program.id) : Promise.resolve([]),
    getBranding(),
  ]);
  return <ProgramSitePage site={site} seasons={seasons} origin={primaryOrigin()} orgName={orgName} />;
}
