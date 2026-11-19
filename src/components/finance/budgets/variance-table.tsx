import { NUM } from "@/components/finance/reports/report-ui";
import { EmptyState } from "@/components/ui";
import type { VarianceRow, VarianceStatus, VarianceTotals } from "@/lib/finance/budget-math";
import { formatAmount } from "@/lib/finance/report-math";
import { cn } from "@/lib/utils";

/**
 * Money without the reports' red-for-negative styling: here a negative variance can be GOOD (spending under
 * budget), so meaning comes from the row tint and the text flag instead.
 */
function Amt({ cents, bold }: { cents: number; bold?: boolean }) {
  return <span className={bold ? "font-bold tabular-nums" : "tabular-nums"}>{formatAmount(cents, { dash: true, symbol: false })}</span>;
}

const PCT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

function Pct({ pct }: { pct: number | null }) {
  return <>{pct === null ? <span className="text-stone-300">n/a</span> : PCT.format(pct)}</>;
}

/** Expense overages are red, revenue shortfalls amber. A text flag backs up the color. */
function Flag({ status, type }: { status: VarianceStatus; type: "revenue" | "expense" | "net" }) {
  if (status === "over") return <span className="rounded-full bg-coral/40 px-2 py-0.5 text-[11px] font-semibold text-rose-950 print:border print:border-black print:bg-white print:text-black">Over budget</span>;
  if (status === "short")
    return (
      <span className="rounded-full bg-amber-soft/50 px-2 py-0.5 text-[11px] font-semibold text-amber-950 print:border print:border-black print:bg-white print:text-black">
        {type === "net" ? "Below budget" : "Under budget"}
      </span>
    );
  return null;
}

const rowTone = (s: VarianceStatus) => (s === "over" ? "bg-coral/15 print:bg-white" : s === "short" ? "bg-amber-soft/25 print:bg-white" : "");

export function VarianceTable({ rows, totals }: { rows: VarianceRow[]; totals: VarianceTotals }) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing to compare yet" description="This budget has no amounts for the period, and there is no activity in it." />;
  }
  const revenue = rows.filter((r) => r.type === "revenue");
  const expense = rows.filter((r) => r.type === "expense");
  const section = (label: string, list: VarianceRow[], t: VarianceTotals["revenue"], kind: "revenue" | "expense") =>
    list.length === 0 ? null : (
      <>
        <tr className="bg-alabaster/70">
          <td colSpan={7} className="px-2 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-600">
            {label}
          </td>
        </tr>
        {list.map((r) => (
          <tr key={`${r.accountId}|${r.programId ?? ""}`} className={cn("border-b border-line-soft", rowTone(r.status))} data-testid="variance-row" data-status={r.status}>
            <td className="px-2 py-2.5">
              <span className="text-stone-400">{r.code}</span> {r.name}
            </td>
            <td className="px-2 py-2.5 text-xs text-stone-600">{r.programName}</td>
            <td className={cn("px-2 py-2.5", NUM)}>
              <Amt cents={r.budgetCents} />
            </td>
            <td className={cn("px-2 py-2.5", NUM)}>
              <Amt cents={r.actualCents} />
            </td>
            <td className={cn("px-2 py-2.5", NUM)}>
              <Amt cents={r.varianceCents} />
            </td>
            <td className={cn("px-2 py-2.5", NUM)}>
              <Pct pct={r.pct} />
            </td>
            <td className="px-2 py-2.5">
              <Flag status={r.status} type={kind} />
            </td>
          </tr>
        ))}
        <tr className={cn("border-b border-stone-300 font-semibold", rowTone(t.status))} data-testid={`variance-total-${kind}`}>
          <td className="px-2 py-2.5" colSpan={2}>
            Total {kind === "revenue" ? "revenue" : "expenses"}
          </td>
          <td className={cn("px-2 py-2.5", NUM)}>
            <Amt cents={t.budgetCents} bold />
          </td>
          <td className={cn("px-2 py-2.5", NUM)}>
            <Amt cents={t.actualCents} bold />
          </td>
          <td className={cn("px-2 py-2.5", NUM)}>
            <Amt cents={t.varianceCents} bold />
          </td>
          <td className={cn("px-2 py-2.5", NUM)}>
            <Pct pct={t.pct} />
          </td>
          <td className="px-2 py-2.5">
            <Flag status={t.status} type={kind} />
          </td>
        </tr>
      </>
    );
  return (
    <div className="overflow-x-auto" data-testid="variance-table">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#ECEAE3] text-[12px] uppercase tracking-wider text-stone-400">
            <th className="px-2 pb-3 font-semibold">Account</th>
            <th className="px-2 pb-3 font-semibold">Program</th>
            <th className={cn("px-2 pb-3 font-semibold", NUM)}>Budget</th>
            <th className={cn("px-2 pb-3 font-semibold", NUM)}>Actual</th>
            <th className={cn("px-2 pb-3 font-semibold", NUM)}>Variance $</th>
            <th className={cn("px-2 pb-3 font-semibold", NUM)}>Variance %</th>
            <th className="px-2 pb-3 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {section("Revenue", revenue, totals.revenue, "revenue")}
          {section("Expenses", expense, totals.expense, "expense")}
          <tr className={cn("border-t-2 border-stone-300 font-bold", rowTone(totals.net.status))} data-testid="variance-total-net">
            <td className="px-2 py-3" colSpan={2}>
              Net (revenue minus expenses)
            </td>
            <td className={cn("px-2 py-3", NUM)}>
              <Amt cents={totals.net.budgetCents} bold />
            </td>
            <td className={cn("px-2 py-3", NUM)}>
              <Amt cents={totals.net.actualCents} bold />
            </td>
            <td className={cn("px-2 py-3", NUM)}>
              <Amt cents={totals.net.varianceCents} bold />
            </td>
            <td className={cn("px-2 py-3", NUM)}>
              <Pct pct={totals.net.pct} />
            </td>
            <td className="px-2 py-3">
              <Flag status={totals.net.status} type="net" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
