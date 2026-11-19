import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { TeamBuilder } from "@/components/teams/team-builder";
import { DalError, requireSession } from "@/lib/dal/context";
import { getTeamBuilder } from "@/lib/dal/teams";

export const metadata: Metadata = { title: "Season Teams" };

export default async function SeasonTeamsPage({ params }: { params: Promise<{ slug: string; seasonId: string }> }) {
  const { slug, seasonId } = await params;
  const path = `/programs/${slug}/seasons/${seasonId}/teams`;
  const ctx = await requireSession(path);

  let data;
  try {
    data = await getTeamBuilder(ctx, seasonId);
  } catch (e) {
    if (e instanceof DalError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  if (data.header.programSlug !== slug) notFound();
  const { header } = data;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {!header.programActive ? <InactiveProgramBanner /> : null}
      <div className="min-w-0">
        <Link href={`/programs/${slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          ← {header.programName}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal sm:text-3xl">{header.seasonName} teams</h1>
        <p className="mt-1 text-sm text-stone-500">
          Build teams, place registered players, and assign coaches.{" "}
          <Link href={`/programs/${slug}/seasons/${seasonId}/registrations`} className="font-semibold text-charcoal underline decoration-stone-300 underline-offset-2">
            Registrations
          </Link>
        </p>
      </div>
      <TeamBuilder data={data} slug={slug} path={path} />
    </div>
  );
}
