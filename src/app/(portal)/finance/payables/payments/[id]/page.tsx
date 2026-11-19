import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { VoidPaymentButton } from "@/components/finance/payables/void-payment-button";
import { Badge, Card, CardHeader, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getPayment } from "@/lib/dal/finance-payments-out";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/finance-bills";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Payment" };
export const dynamic = "force-dynamic";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/payables/payments/${id}`);
  const p = await guarded(() => getPayment(ctx, id));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/payables/payments" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Payments made</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">
              {money(p.amountCents)} to {p.contactName}
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              {fmtDay(p.paymentDate)} · {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}
              {p.reference ? ` ${p.reference}` : ""} · from {p.accountCode} {p.accountName}
            </p>
            {p.voidedAt ? (
              <p className="mt-2 rounded-xl bg-alabaster px-3.5 py-2.5 text-sm text-stone-600" data-testid="payment-voided">
                <Badge>Void</Badge> Voided on {formatDateTime(p.voidedAt)}. {p.voidReason}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {!p.voidedAt && p.method === "check" ? (
              <Link href={`/finance/payables/payments/${p.id}/check`} className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="check-details">
                Print check details
              </Link>
            ) : null}
            {p.canVoid ? <VoidPaymentButton paymentId={p.id} /> : null}
          </div>
        </div>
      </div>
      <Card>
        <CardHeader title="What it paid" />
        <ul className="divide-y divide-line-soft text-sm">
          {p.applications.map((a) => (
            <li key={a.billId} className="flex items-baseline justify-between gap-3 py-2.5">
              <Link href={`/finance/payables/${a.billId}`} className="min-w-0 break-words font-semibold hover:underline">
                {a.vendorInvoiceNumber ? `#${a.vendorInvoiceNumber} · ` : ""}
                {a.memo}
              </Link>
              <span className="shrink-0 tabular-nums">{money(a.amountCents)}</span>
            </li>
          ))}
        </ul>
        {p.memo ? <p className="mt-3 text-sm text-stone-600">Note: {p.memo}</p> : null}
        <p className="mt-3 text-xs text-stone-500">
          Recorded by {p.createdByName} on {formatDateTime(p.createdAt)}
          {p.entryNumber ? (
            <>
              {" "}
              ·{" "}
              <Link href={`/finance/journal/${p.journalEntryId}`} className="underline">
                journal entry #{p.entryNumber}
              </Link>
            </>
          ) : null}
        </p>
      </Card>
    </div>
  );
}
