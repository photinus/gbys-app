import { DalError, getSessionContext } from "@/lib/dal/context";
import { export1099Csv } from "@/lib/dal/finance-payables-reports";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /finance/reports/1099/csv?year=YYYY: 1099 vendor CSV. Full tax ids only for finance admins
 * (each one revealed is audited); everyone else with org-wide read gets the last 4 digits.
 */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return notFound();
  const y = Number(new URL(request.url).searchParams.get("year"));
  try {
    const { csv, filename } = await export1099Csv(ctx, { year: Number.isInteger(y) ? y : undefined });
    return new Response(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
