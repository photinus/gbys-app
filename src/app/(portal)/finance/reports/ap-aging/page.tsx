import type { Metadata } from "next";
import Link from "next/link";
import { guard } from "@/components/finance/reports/page-helpers";
import { Amt, NUM, PeriodControls, ReportFrame, fmtIso } from "@/components/finance/reports/report-ui";
import { Card, EmptyState } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getApAging } from "@/lib/dal/finance-payables-reports";
import { AGING_BUCKETS, AGING_LABELS } from "@/lib/finance/payables-math";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "A/P aging" };
export const dynamic = "force-dynamic";

export default async function ApAgingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/reports/ap-aging");
  const sp = await searchParams;
  const asOfRaw = Array.isArray(sp.asOf) ? sp.asOf[0] : sp.asOf;
  const r = await guard(getApAging(ctx, { asOf: asOfRaw }));
  return (
    <ReportFrame
      title="A/P aging"
      subtitle="Bills we still owe, grouped by how late they are. Reimbursements are included."
      period={`As of ${fmtIso(r.asOf)}`}
      csvHref={`/finance/reports/ap-aging/csv?asOf=${r.asOf}`}
      controls={<PeriodControls basePath="/finance/reports/ap-aging" meta={r.meta} mode="asof" asOf={r.asOf} />}
    >
      {r.rows.length === 0 ? (
        <EmptyState title="Nothing was owed on this date" description="No approved bills had an unpaid balance." />
      ) : (
        <>
          <Card className="print:border-0 print:p-0 print:shadow-none">
            <h2 className="mb-3 text-lg font-bold">By payee</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="aging-summary">
                <thead>
                  <tr className="border-b border-line text-xs font-semibold uppercase tracking-wider text-stone-400">
                    <th className="py-2 pr-3 text-left">Payee</th>
                    {AGING_BUCKETS.map((b) => (
                      <th key={b} className={cn("px-2 py-2", NUM)}>{AGING_LABELS[b]}</th>
                    ))}
                    <th className={cn("py-2 pl-2", NUM)}>Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {r.contacts.map((c) => (
                    <tr key={c.contactId}>
                      <td className="py-2.5 pr-3">
                        <Link href={`/finance/payables?contact=${c.contactId}`} className="font-semibold hover:underline">
                          {c.contactName}
                        </Link>
                      </td>
                      {AGING_BUCKETS.map((b) => (
                        <td key={b} className={cn("px-2 py-2.5", NUM)}>
                          <Amt cents={c.buckets[b]} />
                        </td>
                      ))}
                      <td className={cn("py-2.5 pl-2 font-semibold", NUM)}>
                        <Amt cents={c.buckets.total} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-charcoal font-bold">
                    <td className="py-2.5 pr-3">Total owed</td>
                    {AGING_BUCKETS.map((b) => (
                      <td key={b} className={cn("px-2 py-2.5", NUM)}>
                        <Amt cents={r.totals[b]} bold />
                      </td>
                    ))}
                    <td className={cn("py-2.5 pl-2", NUM)}>
                      <Amt cents={r.totals.total} bold symbol />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="print:border-0 print:p-0 print:shadow-none">
            <h2 className="mb-3 text-lg font-bold">Every open bill</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm" data-testid="aging-detail">
                <thead>
                  <tr className="border-b border-line text-xs font-semibold uppercase tracking-wider text-stone-400">
                    <th className="py-2 pr-3 text-left">Payee</th>
                    <th className="px-2 py-2 text-left">For</th>
                    <th className="px-2 py-2 text-left">Due</th>
                    <th className="px-2 py-2 text-left">Age</th>
                    <th className={cn("py-2 pl-2", NUM)}>Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {r.rows.map((x) => (
                    <tr key={x.billId}>
                      <td className="py-2.5 pr-3 font-semibold">{x.contactName}</td>
                      <td className="max-w-[18rem] break-words px-2 py-2.5 text-stone-600">
                        <Link href={`/finance/payables/${x.billId}`} className="hover:underline">
                          {x.vendorInvoiceNumber ? `#${x.vendorInvoiceNumber} · ` : ""}
                          {x.memo}
                        </Link>
                        {x.kind === "reimbursement" ? <span className="ml-1 text-xs text-stone-400">(reimbursement)</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5">{fmtIso(x.dueDate)}</td>
                      <td className={cn("whitespace-nowrap px-2 py-2.5", x.daysPastDue > 0 ? "text-rose-700 print:text-black" : "text-stone-500")}>
                        {x.daysPastDue > 0 ? `${x.daysPastDue} days late` : "Not due yet"}
                      </td>
                      <td className={cn("py-2.5 pl-2", NUM)}>
                        <Amt cents={x.balanceCents} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </ReportFrame>
  );
}
