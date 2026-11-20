import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Target } from "lucide-react";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { Badge, Card, EmptyState, TBody, TD, TH, THead, TR, Table, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { listBudgets } from "@/lib/dal/finance-budgets";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Budgets" };
export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const ctx = await requireSession("/finance/budgets");
  const { budgets, canEdit, scoped } = await guarded(() => listBudgets(ctx));
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Budgets</h1>
          <p className="mt-1 text-sm text-stone-500">
            Plan the year month by month, adopt the official version, then see how you are tracking.
            {scoped ? " You see the adopted budgets, limited to the programs you have access to." : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/finance/reports/budget" className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="budget-report-link">
            <Target className="h-4 w-4" /> Budget vs. actual
          </Link>
          {canEdit ? (
            <Link href="/finance/budgets/new" className={buttonStyles({ size: "sm" })} data-testid="new-budget">
              <Plus className="h-4 w-4" /> New budget
            </Link>
          ) : null}
        </div>
      </div>
      <Card>
        {budgets.length === 0 ? (
          <EmptyState
            title="No budgets yet"
            description={scoped ? "An adopted budget will appear here." : "Start a budget for this fiscal year, blank or from last year's numbers."}
            action={
              canEdit ? (
                <Link href="/finance/budgets/new" className={buttonStyles({ size: "sm" })}>
                  New budget
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table className="min-w-0 sm:min-w-[640px]">
            <THead>
              <tr>
                <TH>Budget</TH>
                <TH className="hidden sm:table-cell">Fiscal year</TH>
                <TH className="hidden text-right sm:table-cell">Revenue</TH>
                <TH className="hidden text-right sm:table-cell">Expenses</TH>
                <TH className="text-right">Surplus</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {budgets.map((b) => (
                <TR key={b.id} data-testid="budget-row">
                  <TD className="max-w-[260px]">
                    <Link href={`/finance/budgets/${b.id}`} className="block truncate font-semibold text-indigo-700 hover:underline">
                      {b.name}
                    </Link>
                    <span className="text-xs text-stone-400">
                      {b.fyLabel} · {b.lineCount} lines
                    </span>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-xs sm:table-cell">
                    {b.fyLabel}
                    <span className="block text-stone-400">
                      {fmtDay(b.fiscalYearStart)} to {fmtDay(b.fiscalYearEnd)}
                    </span>
                  </TD>
                  <TD className="hidden text-right tabular-nums sm:table-cell">{money(b.revenueCents)}</TD>
                  <TD className="hidden text-right tabular-nums sm:table-cell">{money(b.expenseCents)}</TD>
                  <TD className={cn("text-right tabular-nums", b.netCents < 0 && "text-rose-700")}>{money(b.netCents)}</TD>
                  <TD>{b.status === "adopted" ? <Badge tone="success">Adopted</Badge> : <Badge tone="warning">Draft</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
