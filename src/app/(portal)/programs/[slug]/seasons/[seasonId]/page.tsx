import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { SeasonEditor } from "@/components/seasons/season-editor";
import { SeasonReadOnly } from "@/components/seasons/season-readonly";
import { SeasonStatusBadge } from "@/components/seasons/season-status-badge";
import { buttonStyles } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getSeasonForEdit, previewSeasonForm } from "@/lib/dal/seasons";

export const metadata: Metadata = { title: "Season" };

export default async function SeasonPage({ params }: { params: Promise<{ slug: string; seasonId: string }> }) {
  const { slug, seasonId } = await params;
  const ctx = await requireSession(`/programs/${slug}/seasons/${seasonId}`);
  let data, preview;
  try {
    data = await getSeasonForEdit(ctx, slug, seasonId);
    preview = data.canManage ? null : await previewSeasonForm(ctx, seasonId);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const base = `/programs/${slug}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      {!data.program.isActive ? <InactiveProgramBanner /> : null}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <Link href={base} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
            {data.program.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-charcoal">{data.season.name}</h1>
            <SeasonStatusBadge status={data.season.status} />
          </div>
          <p className="mt-1 text-sm text-stone-500">{data.canManage ? "Edit this season." : "Read-only view."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/seasons/${seasonId}/registrations`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
            Registrations
          </Link>
          <Link href={`${base}/seasons/${seasonId}/emergency`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
            Emergency sheet
          </Link>
        </div>
      </div>
      {data.canManage ? (
        <SeasonEditor
          key={data.season.id}
          program={data.program}
          season={data.season}
          waiverVersions={data.waiverVersions}
          canOrgWideWaiver={data.canOrgWideWaiver}
          liveRegistrations={data.liveRegistrations}
        />
      ) : (
        <SeasonReadOnly data={data} preview={preview!} />
      )}
    </div>
  );
}
