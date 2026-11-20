import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProgramSitePage } from "@/components/program-site/program-site-page";
import { EmptyState, buttonStyles } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getSiteForPreview } from "@/lib/dal/program-sites";
import { listOpenSeasonsForProgram } from "@/lib/dal/registrations";
import { getBranding } from "@/lib/dal/settings";

export const metadata: Metadata = { title: "Home page preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Program admins / board: the public page as it would render, published or not. */
export default async function HomePagePreview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession(`/programs/${slug}/home-page/preview`);
  let site;
  try {
    site = await getSiteForPreview(ctx, slug);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const editorHref = `/programs/${slug}/home-page`;
  if (!site) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <EmptyState
          title="No home page yet"
          description="Set up your program's home page in the editor, then come back to preview it."
          action={
            <Link href={editorHref} className={buttonStyles({ size: "sm" })}>
              Open the editor
            </Link>
          }
        />
      </div>
    );
  }
  const [seasons, { orgName }] = await Promise.all([
    site.showOpenRegistrations ? listOpenSeasonsForProgram(site.program.id) : Promise.resolve([]),
    getBranding(),
  ]);
  return (
    <div className="mx-auto w-full max-w-5xl">
      <ProgramSitePage site={site} seasons={seasons} preview orgName={orgName} editorHref={editorHref} />
    </div>
  );
}
