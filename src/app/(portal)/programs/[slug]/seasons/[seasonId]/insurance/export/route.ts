import { getSessionContext, DalError } from "@/lib/dal/context";
import { buildInsuranceCsv, getInsuranceExport, insuranceFilename } from "@/lib/dal/insurance-export";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; seasonId: string }> }
) {
  // Route handlers bypass layouts: authorize here. Existence is hidden from everyone but program admins / board.
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const { slug, seasonId } = await params;
  const sp = new URL(request.url).searchParams;
  const part = sp.get("part");
  try {
    const data = await getInsuranceExport(ctx, seasonId, {
      teamId: sp.get("team") || null,
      format: "csv",
      expectedProgramSlug: slug,
    });
    const csv = buildInsuranceCsv(data, part === "players" || part === "staff" ? part : "all");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${insuranceFilename(data.header.programSlug, data.header.seasonName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
