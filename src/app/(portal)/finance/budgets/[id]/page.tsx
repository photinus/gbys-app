import type { Metadata } from "next";
import Link from "next/link";
import { Target } from "lucide-react";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay } from "@/components/finance/gl/format";
import { BudgetActions } from "@/components/finance/budgets/budget-actions";
import { BudgetGrid } from "@/components/finance/budgets/budget-grid";
import { Badge, Card, CardHeader, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { getBudget, getBudgetEditorOptions } from "@/lib/dal/finance-budgets";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Budget" };
export const dynamic = "force-dynamic";

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/budgets/${id}`);
  const { budget, options, canEditAny } = await guarded(async () => {
    const budget = await getBudget(ctx, id);
    return {
      budget,
      options: budget.canEdit ? await getBudgetEditorOptions(ctx) : undefined,
      canEditAny: canEditBooks(await getFinanceAccess(ctx)),
    };
  });
  const adopted = budget.status === "adopted";
  const readOnlyReason = adopted
    ? "This budget is adopted, so it can't be changed. A finance admin can un-adopt it (with a reason) if the plan needs to be revised."
    : budget.scoped
      ? "You see only the lines for the programs you have access to."
      : !budget.canEdit
        ? "You have read-only access to budgets."
        : undefined;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/budgets" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Budgets</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="budget-title">
              {budget.name}{" "}
              {adopted ? (
                <Badge tone="success" className="align-middle">Adopted</Badge>
              ) : (
                <Badge tone="warning" className="align-middle">Draft</Badge>
              )}
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              {budget.fyLabel} · {fmtDay(budget.fiscalYearStart)} to {fmtDay(budget.fiscalYearEnd)}
              {adopted && budget.adoptedAt ? ` · adopted ${formatDateTime(budget.adoptedAt)}${budget.adoptedByName ? ` by ${budget.adoptedByName}` : ""}` : ""}
            </p>
            {budget.notes && !budget.canEdit ? <p className="mt-2 whitespace-pre-line text-sm text-stone-600">{budget.notes}</p> : null}
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <Link href={`/finance/reports/budget?budget=${budget.id}`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
              <Target className="h-4 w-4" /> Budget vs. actual
            </Link>
            <BudgetActions budgetId={budget.id} name={budget.name} status={budget.status} canAdopt={budget.canAdopt} canEdit={canEditAny} />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Monthly amounts"
          description={`Months run from ${budget.monthLabels[0]} to ${budget.monthLabels[11]}. Revenue and expenses are both entered as positive amounts.`}
        />
        <BudgetGrid
          // Remount when the budget's saved state changes under us (adopt / un-adopt / another save).
          key={`${budget.status}-${budget.updatedAt.getTime()}`}
          budgetId={budget.id}
          name={budget.name}
          notes={budget.notes}
          monthLabels={budget.monthLabels}
          lines={budget.lines.map((l) => ({
            accountId: l.accountId,
            accountCode: l.accountCode,
            accountName: l.accountName,
            accountType: l.accountType,
            programId: l.programId,
            programName: l.programName,
            monthlyCents: l.monthlyCents,
            note: l.note,
          }))}
          options={options}
          readOnlyReason={readOnlyReason}
        />
      </Card>
    </div>
  );
}
