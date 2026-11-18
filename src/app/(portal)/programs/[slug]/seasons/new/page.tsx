import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { SeasonEditor } from "@/components/seasons/season-editor";
import { DalError, requireSession } from "@/lib/dal/context";
import { getNewSeasonContext } from "@/lib/dal/seasons";

export const metadata: Metadata = { title: "New season" };

export default async function NewSeasonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession(`/programs/${slug}/seasons/new`);
  let data;
  try {
    data = await getNewSeasonContext(ctx, slug);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {!data.program.isActive ? <InactiveProgramBanner /> : null}
      <div>
        <Link href={`/programs/${slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          {data.program.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">New season</h1>
        <p className="mt-1 text-sm text-stone-500">Set the dates, fee, waiver and questions. You can change most of this later.</p>
      </div>
      <SeasonEditor program={data.program} waiverVersions={data.waiverVersions} canOrgWideWaiver={data.canOrgWideWaiver} />
    </div>
  );
}
