import { DalError, getSessionContext } from "@/lib/dal/context";
import { exportDonorReportCsv } from "@/lib/dal/finance-donations";
import { isIsoDate } from "@/lib/finance/dates";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** GET /finance/reports/donors/export?from&to — audited CSV of the donor report. */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!isIsoDate(from) || !isIsoDate(to)) return notFound();
  try {
    const { csv, filename } = await exportDonorReportCsv(ctx, { from: from <= to ? from : to, to: from <= to ? to : from });
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
