import type { Metadata } from "next";
import Link from "next/link";
import { VarianceTable } from "@/components/finance/budgets/variance-table";
import { guard } from "@/components/finance/reports/page-helpers";
import { ReportFrame, fmtIso } from "@/components/finance/reports/report-ui";
import { Badge, Button, Card, EmptyState, Label, Select, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getBudgetVsActual } from "@/lib/dal/finance-budgets";

export const metadata: Metadata = { title: "Budget vs. actual" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function BudgetReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/reports/budget");
  const sp = await searchParams;
  const q = { budgetId: one(sp.budget), period: one(sp.period), month: one(sp.month) };
  const r = await guard(getBudgetVsActual(ctx, q));

  if (!r.budget || !r.period || !r.totals) {
    return (
      <ReportFrame title="Budget vs. actual" subtitle="How actual revenue and expenses compare with a budget." period="">
        <Card>
          <EmptyState
            title="No budget to compare yet"
            description={r.scoped ? "No budget has been adopted yet. The finance team will adopt one for the year." : "Create a budget first, then come back here to see how you are tracking."}
            action={
              !r.scoped ? (
                <Link href="/finance/budgets" className={buttonStyles({ size: "sm" })}>
                  Go to budgets
                </Link>
              ) : undefined
            }
          />
        </Card>
      </ReportFrame>
    );
  }
  const params: Record<string, string> = { budget: r.budget.id, period: r.period.kind, month: r.period.to.slice(0, 7) };
  const csvHref = `/finance/reports/budget/export?${new URLSearchParams(params).toString()}`;

  return (
    <ReportFrame
      title="Budget vs. actual"
      subtitle="Actuals come from the books for the same months. Variance is actual minus budget: spending above budget shows red, income below budget shows amber."
      period={`${r.budget.name} · ${r.period.label}`}
      csvHref={csvHref}
      controls={
        <Card className="print:hidden">
          <form method="get" className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end" data-testid="budget-report-controls">
            <div className="min-w-0 sm:w-72">
              <Label htmlFor="br-budget">Budget</Label>
              <Select id="br-budget" name="budget" defaultValue={r.budget.id}>
                {r.budgets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.fyLabel}){b.status === "adopted" ? " · adopted" : " · draft"}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="br-period">Period</Label>
              <Select id="br-period" name="period" defaultValue={r.period.kind}>
                <option value="month">One month</option>
                <option value="ytd">Year to date (through month)</option>
                <option value="year">Full year</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="br-month">Month</Label>
              <Select id="br-month" name="month" defaultValue={r.period.to.slice(0, 7)}>
                {r.monthOptions.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit">Update report</Button>
          </form>
          <p className="mt-3 text-xs text-stone-500">
            Fiscal year {r.budget.fyLabel}: {fmtIso(r.budget.fiscalYearStart)} to {fmtIso(r.budget.fiscalYearEnd)}.{" "}
            {r.scoped ? "You see the lines for the programs you have access to." : null}
          </p>
        </Card>
      }
    >
      <Card className="print:border-0 print:p-0 print:shadow-none">
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-600 print:hidden">
          {r.period.label} · {fmtIso(r.period.from)} to {fmtIso(r.period.to)}
          {r.budget.status === "draft" ? <Badge tone="warning">Draft budget</Badge> : <Badge tone="success">Adopted</Badge>}
        </p>
        <VarianceTable rows={r.rows} totals={r.totals} />
        <p className="mt-4 text-xs text-stone-500">
          Accounts that had activity but no budget show a $0 budget. Variance % is blank when the budget is $0.
        </p>
      </Card>
    </ReportFrame>
  );
}
