import { DalError, getSessionContext } from "@/lib/dal/context";
import { REPORT_KEYS, exportReportCsv, type ReportKey } from "@/lib/dal/finance-reports";
import { toReportQuery } from "@/components/finance/reports/page-helpers";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** GET /finance/reports/export?report=<key>&from&to&asOf&program&fund&account — audited CSV download. */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const sp = new URL(request.url).searchParams;
  const report = sp.get("report") as ReportKey | null;
  if (!report || !REPORT_KEYS.includes(report)) return notFound();
  const q = toReportQuery(Object.fromEntries(sp.entries()));
  try {
    const { csv, filename } = await exportReportCsv(ctx, report, q);
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
