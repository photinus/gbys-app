import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { EmergencySheetView } from "@/components/rosters/emergency-sheet";
import { DalError, requireSession } from "@/lib/dal/context";
import { getEmergencySheet } from "@/lib/dal/rosters";

export const metadata: Metadata = { title: "Emergency Sheet", robots: { index: false, follow: false } };
// Medical data: always rendered per request. Next sends
// `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` for dynamic pages.
export const dynamic = "force-dynamic";

export default async function EmergencySheetPage({
  params,
}: {
  params: Promise<{ slug: string; seasonId: string }>;
}) {
  const { slug, seasonId } = await params;
  const ctx = await requireSession(`/programs/${slug}/seasons/${seasonId}/emergency`);

  let sheet;
  try {
    sheet = await getEmergencySheet(ctx, seasonId, slug);
  } catch (e) {
    if (e instanceof DalError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  if (sheet.header.programSlug !== slug) notFound();

  return (
    <>
      {!sheet.header.programActive ? <InactiveProgramBanner className="mb-4" /> : null}
      <EmergencySheetView sheet={sheet} />
    </>
  );
}
