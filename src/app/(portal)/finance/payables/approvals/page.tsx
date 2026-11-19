import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { KindTag } from "@/components/finance/payables/shared";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { listApprovalQueue, type QueueRow } from "@/lib/dal/finance-bills";

export const metadata: Metadata = { title: "Waiting for my approval" };
export const dynamic = "force-dynamic";

function Item({ b }: { b: QueueRow }) {
  return (
    <li className="py-3.5">
      <Link href={`/finance/payables/${b.id}`} className="block space-y-1.5" data-testid="queue-item">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words text-sm font-semibold text-charcoal">
            {b.contactName} <KindTag kind={b.kind} />
          </p>
          <p className="shrink-0 text-sm font-bold tabular-nums">{money(b.totalCents)}</p>
        </div>
        <p className="break-words text-xs text-stone-500">{b.memo}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          {b.approvalsRequired > 1 ? (
            <Badge tone="warning">
              {b.approvalsSoFar} of {b.approvalsRequired} approvals
            </Badge>
          ) : null}
          {b.dueDate ? <span>Due {fmtDay(b.dueDate)}</span> : null}
          {b.blockedReason ? <span className="font-semibold text-stone-600">{b.blockedReason}</span> : null}
        </div>
      </Link>
    </li>
  );
}

export default async function ApprovalsPage() {
  const ctx = await requireSession("/finance/payables/approvals");
  const { mine, waiting } = await guarded(() => listApprovalQueue(ctx));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/payables" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Bills &amp; payables</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Waiting for my approval</h1>
        <p className="mt-1 text-sm text-stone-500">
          You can approve anything except what you created, submitted or are being paid for. Larger amounts need two different approvers.
        </p>
      </div>
      <Card>
        <CardHeader title={`Ready for you (${mine.length})`} />
        {mine.length === 0 ? (
          <EmptyState title="Nothing is waiting for you" description="New bills and reimbursement claims will show up here." />
        ) : (
          <ul className="divide-y divide-line-soft" data-testid="queue-mine">
            {mine.map((b) => (
              <Item key={b.id} b={b} />
            ))}
          </ul>
        )}
      </Card>
      {waiting.length > 0 ? (
        <Card>
          <CardHeader title={`Waiting on someone else (${waiting.length})`} description="You can look at these, but another approver has to decide." />
          <ul className="divide-y divide-line-soft" data-testid="queue-waiting">
            {waiting.map((b) => (
              <Item key={b.id} b={b} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
