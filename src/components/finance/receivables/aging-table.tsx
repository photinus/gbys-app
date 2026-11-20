import Link from "next/link";
import { Amt, NUM, fmtIso } from "@/components/finance/reports/report-ui";
import { Card, EmptyState } from "@/components/ui";
import { AGING_BUCKETS, AGING_LABELS, type AgingReport } from "@/lib/finance/ar-aging";
import { cn } from "@/lib/utils";

/** A/R aging: customers with their invoices spread across due-date buckets. Scrolls inside its own wrapper on phones. */
export function AgingTable({ report, linkInvoices = true }: { report: AgingReport; linkInvoices?: boolean }) {
  if (report.groups.length === 0) {
    return <EmptyState title="Nothing is owed" description={`No unpaid invoices as of ${fmtIso(report.asOf)}.`} />;
  }
  return (
    <div className="overflow-x-auto" data-testid="aging-table">
      <table className="w-full min-w-[820px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#ECEAE3] text-[12px] uppercase tracking-wider text-stone-400">
            <th className="px-2 pb-3 font-semibold">Customer / invoice</th>
            <th className="px-2 pb-3 font-semibold">Due</th>
            {AGING_BUCKETS.map((b) => (
              <th key={b} className={cn("px-2 pb-3 font-semibold", NUM)}>
                {AGING_LABELS[b]}
              </th>
            ))}
            <th className={cn("px-2 pb-3 font-semibold", NUM)}>Total</th>
          </tr>
        </thead>
        <tbody>
          {report.groups.map((g) => (
            <GroupRows key={g.contactId} g={g} linkInvoices={linkInvoices} />
          ))}
          <tr className="border-t-2 border-stone-300 font-bold">
            <td className="px-2 py-3" colSpan={2}>
              Total owed
            </td>
            {AGING_BUCKETS.map((b) => (
              <td key={b} className={cn("px-2 py-3", NUM)}>
                <Amt cents={report.totals[b]} bold />
              </td>
            ))}
            <td className={cn("px-2 py-3", NUM)} data-testid="aging-total">
              <Amt cents={report.totals.total} bold />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ g, linkInvoices }: { g: AgingReport["groups"][number]; linkInvoices: boolean }) {
  return (
    <>
      <tr className="bg-alabaster/70">
        <td colSpan={8} className="px-2 py-2 text-xs font-bold uppercase tracking-wider text-stone-600">
          {g.contactName}
        </td>
      </tr>
      {g.rows.map((r) => (
        <tr key={r.invoiceId} className="border-b border-line-soft" data-testid="aging-row">
          <td className="px-2 py-2.5 pl-5">
            {linkInvoices ? (
              <Link href={`/finance/receivables/${r.invoiceId}`} className="font-semibold text-indigo-700 hover:underline print:text-black print:no-underline">
                Invoice #{r.number}
              </Link>
            ) : (
              `Invoice #${r.number}`
            )}
            <span className="block text-xs text-stone-400">Issued {fmtIso(r.issueDate)}</span>
          </td>
          <td className="whitespace-nowrap px-2 py-2.5 text-xs">
            {r.dueDate ? fmtIso(r.dueDate) : "On receipt"}
            {r.daysPastDue > 0 ? <span className="block text-rose-700 print:text-black">{r.daysPastDue} days late</span> : null}
          </td>
          {AGING_BUCKETS.map((b) => (
            <td key={b} className={cn("px-2 py-2.5", NUM)}>
              {r.bucket === b ? <Amt cents={r.balanceCents} /> : <span className="text-stone-300">–</span>}
            </td>
          ))}
          <td className={cn("px-2 py-2.5", NUM)}>
            <Amt cents={r.balanceCents} />
          </td>
        </tr>
      ))}
      <tr className="border-b border-stone-300 font-semibold">
        <td className="px-2 py-2.5 pl-5" colSpan={2}>
          {g.contactName} total
        </td>
        {AGING_BUCKETS.map((b) => (
          <td key={b} className={cn("px-2 py-2.5", NUM)}>
            <Amt cents={g.totals[b]} bold />
          </td>
        ))}
        <td className={cn("px-2 py-2.5", NUM)}>
          <Amt cents={g.totals.total} bold />
        </td>
      </tr>
    </>
  );
}

/** Wrap in a Card (kept separate so the page can control print styles). */
export function AgingCard({ children }: { children: React.ReactNode }) {
  return <Card className="print:border-0 print:p-0 print:shadow-none">{children}</Card>;
}
