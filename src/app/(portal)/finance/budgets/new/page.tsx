import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { CreateBudgetForm } from "@/components/finance/budgets/create-budget-form";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getCreateBudgetFormData } from "@/lib/dal/finance-budgets";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "New budget" };
export const dynamic = "force-dynamic";

export default async function NewBudgetPage() {
  const ctx = await requireSession("/finance/budgets/new");
  const data = await guarded(() => getCreateBudgetFormData(ctx));
  // fiscalYears = [next, current, previous]; default to the one containing today.
  const today = laToday();
  const current = [...data.fiscalYears].filter((f) => f.start <= today).sort((a, b) => b.start.localeCompare(a.start))[0] ?? data.fiscalYears[0];
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/budgets" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Budgets</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">New budget</h1>
        <p className="mt-1 text-sm text-stone-500">Pick the fiscal year and how to begin. You can edit every amount afterwards.</p>
      </div>
      <Card>
        <CreateBudgetForm data={data} defaultFiscalYear={current.start} />
      </Card>
    </div>
  );
}
