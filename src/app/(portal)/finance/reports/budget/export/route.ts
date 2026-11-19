import { DalError, getSessionContext } from "@/lib/dal/context";
import { exportBudgetVsActualCsv } from "@/lib/dal/finance-budgets";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** GET /finance/reports/budget/export?budget&period&month: audited CSV download (filtered for program users). */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const sp = new URL(request.url).searchParams;
  try {
    const { csv, filename } = await exportBudgetVsActualCsv(ctx, { budgetId: sp.get("budget"), period: sp.get("period"), month: sp.get("month") });
    return new Response(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
