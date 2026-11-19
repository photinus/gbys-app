import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { EmergencySheetView } from "@/components/rosters/emergency-sheet";
import { DalError, requireSession } from "@/lib/dal/context";
import { getTeamEmergencySheet } from "@/lib/dal/rosters";

export const metadata: Metadata = { title: "Team Emergency Sheet", robots: { index: false, follow: false } };
// Medical data: always rendered per request (private, no-store).
export const dynamic = "force-dynamic";

export default async function TeamEmergencySheetPage({
  params,
}: {
  params: Promise<{ slug: string; teamId: string }>;
}) {
  const { slug, teamId } = await params;
  const ctx = await requireSession(`/programs/${slug}/teams/${teamId}/emergency`);

  let sheet;
  try {
    sheet = await getTeamEmergencySheet(ctx, teamId, slug);
  } catch (e) {
    if (e instanceof DalError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }

  return (
    <>
      <Link
        href={`/programs/${slug}/teams/${teamId}`}
        className="mb-3 inline-block text-xs font-semibold text-stone-500 hover:text-charcoal print:hidden"
      >
        ← {sheet.team?.name ?? "Team"}
      </Link>
      {!sheet.header.programActive ? <InactiveProgramBanner className="mb-4" /> : null}
      <EmergencySheetView sheet={sheet} />
    </>
  );
}
