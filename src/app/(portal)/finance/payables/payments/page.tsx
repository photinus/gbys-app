import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { Badge, Card, EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { listPayments } from "@/lib/dal/finance-payments-out";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/finance-bills";

export const metadata: Metadata = { title: "Payments made" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const ctx = await requireSession("/finance/payables/payments");
  const rows = await guarded(() => listPayments(ctx, { limit: 300 }));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/payables" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Bills &amp; payables</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Payments made</h1>
        <p className="mt-1 text-sm text-stone-500">Money paid out for bills and reimbursements.</p>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No payments yet" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Paid to</TH>
                <TH>How</TH>
                <TH>From</TH>
                <TH className="text-right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((p) => (
                <TR key={p.id} className={p.voidedAt ? "text-stone-400 line-through" : undefined}>
                  <TD className="whitespace-nowrap">
                    <Link href={`/finance/payables/payments/${p.id}`} className="font-semibold hover:underline">
                      {fmtDay(p.paymentDate)}
                    </Link>
                  </TD>
                  <TD>{p.contactName}</TD>
                  <TD className="text-stone-600">
                    {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}
                    {p.reference ? ` ${p.reference}` : ""} {p.voidedAt ? <Badge>Void</Badge> : null}
                  </TD>
                  <TD className="text-stone-600">{p.accountName}</TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{money(p.amountCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
