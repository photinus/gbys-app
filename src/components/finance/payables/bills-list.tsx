import Link from "next/link";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui";
import { fmtDay, money } from "@/components/finance/gl/format";
import type { BillRow } from "@/lib/dal/finance-bills";
import { laToday } from "@/lib/finance/dates";
import { BillStatusBadge, KindTag } from "./shared";

function isOverdue(b: BillRow, today: string): boolean {
  return (b.status === "approved" || b.status === "partially_paid") && (b.dueDate ?? b.billDate) < today;
}

/** Bills as a table on wide screens and stacked cards on phones. */
export function BillsList({ rows, basePath = "/finance/payables", empty }: { rows: BillRow[]; basePath?: string; empty?: string }) {
  const today = laToday();
  if (rows.length === 0) return <EmptyState title={empty ?? "No bills here"} description="Bills and reimbursement claims that match will show up in this list." />;
  return (
    <>
      <ul className="divide-y divide-line-soft sm:hidden" data-testid="bills-cards">
        {rows.map((b) => (
          <li key={b.id} className="py-3.5">
            <Link href={`${basePath}/${b.id}`} className="block space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-sm font-semibold text-charcoal">{b.contactName}</p>
                <p className="shrink-0 text-sm font-bold tabular-nums">{money(b.totalCents)}</p>
              </div>
              <p className="break-words text-xs text-stone-500">{b.memo}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <BillStatusBadge status={b.status} />
                <KindTag kind={b.kind} />
                {b.dueDate ? (
                  <span className={isOverdue(b, today) ? "font-semibold text-rose-700" : undefined}>Due {fmtDay(b.dueDate)}</span>
                ) : null}
                {b.paidCents > 0 && b.paidCents < b.totalCents ? <span>Balance {money(b.totalCents - b.paidCents)}</span> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <THead>
            <tr>
              <TH>Payee</TH>
              <TH>For</TH>
              <TH>Due</TH>
              <TH className="text-right">Total</TH>
              <TH className="text-right">Balance</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {rows.map((b) => (
              <TR key={b.id} data-testid="bill-row">
                <TD className="max-w-[16rem]">
                  <Link href={`${basePath}/${b.id}`} className="font-semibold text-charcoal hover:underline">
                    {b.contactName}
                  </Link>
                  {b.vendorInvoiceNumber ? <p className="text-xs text-stone-500">#{b.vendorInvoiceNumber}</p> : null}
                </TD>
                <TD className="max-w-[18rem] break-words text-stone-600">
                  {b.memo} <KindTag kind={b.kind} />
                  {b.programName ? <p className="text-xs text-stone-400">{b.programName}</p> : null}
                </TD>
                <TD className={isOverdue(b, today) ? "whitespace-nowrap font-semibold text-rose-700" : "whitespace-nowrap text-stone-600"}>
                  {b.dueDate ? fmtDay(b.dueDate) : "—"}
                </TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{money(b.totalCents)}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">
                  {b.status === "approved" || b.status === "partially_paid" ? money(b.totalCents - b.paidCents) : "—"}
                </TD>
                <TD>
                  <BillStatusBadge status={b.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}
