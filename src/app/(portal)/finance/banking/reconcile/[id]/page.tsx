import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { guard } from "@/components/finance/banking/guard";
import { ReconcileWorkspace } from "@/components/finance/banking/reconcile-workspace";
import { dateOnly } from "@/components/finance/banking/shared";
import { DalError, requireSession } from "@/lib/dal/context";
import { canEditBooks, requireFinance } from "@/lib/dal/finance-access";
import { getReconciliation } from "@/lib/dal/finance-reconcile";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Reconciliation" };
export const dynamic = "force-dynamic";

export default async function ReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/banking/reconcile/${id}`);
  const [detail, access] = await guard(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DalError("NOT_FOUND");
    const access = await requireFinance(ctx, "view_all");
    return [await getReconciliation(ctx, id), access] as const;
  });
  return (
    <div className="space-y-4">
      <Link href="/finance/banking/reconcile" className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal print:hidden">
        <ArrowLeft className="h-3.5 w-3.5" /> All reconciliations
      </Link>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2 pb-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-charcoal">{detail.accountLabel}</h2>
            <p className="text-xs text-stone-500">Statement ending {formatDate(dateOnly(detail.statementEndDate))}</p>
          </div>
          <Badge tone={detail.status === "completed" ? "success" : "warning"}>{detail.status === "completed" ? "Completed" : "In progress"}</Badge>
        </div>
        <ReconcileWorkspace key={detail.status} detail={detail} canEdit={canEditBooks(access)} />
      </Card>
    </div>
  );
}
