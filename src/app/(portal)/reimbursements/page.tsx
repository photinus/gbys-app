import type { Metadata } from "next";
import Link from "next/link";
import { fmtDay, money } from "@/components/finance/gl/format";
import { ClaimStatusBadge } from "@/components/finance/payables/shared";
import { Card, EmptyState, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { listMyReimbursements } from "@/lib/dal/finance-bills";

export const metadata: Metadata = { title: "Reimbursements" };
export const dynamic = "force-dynamic";

export default async function ReimbursementsPage() {
  const ctx = await requireSession("/reimbursements");
  const claims = await listMyReimbursements(ctx);
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reimbursements</h1>
          <p className="mt-1 text-sm text-stone-500">
            Paid for something out of pocket for GBYS? Send a claim with a photo of the receipt and we&apos;ll pay you back once it&apos;s approved.
          </p>
        </div>
        <Link href="/reimbursements/new" className={buttonStyles({})} data-testid="new-claim">
          New claim
        </Link>
      </div>
      <Card>
        {claims.length === 0 ? (
          <EmptyState title="No claims yet" description="When you send a claim it will show up here so you can follow it." />
        ) : (
          <ul className="divide-y divide-line-soft" data-testid="claims-list">
            {claims.map((c) => (
              <li key={c.id}>
                <Link href={`/reimbursements/${c.id}`} className="block space-y-1.5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-sm font-semibold text-charcoal">{c.memo}</p>
                    <p className="shrink-0 text-sm font-bold tabular-nums">{money(c.totalCents)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <ClaimStatusBadge status={c.status} />
                    <span>Paid on {fmtDay(c.billDate)}</span>
                    {c.programName ? <span>· {c.programName}</span> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
