import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { PrintButton } from "@/components/finance/reports/print-button";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getCheckDetails } from "@/lib/dal/finance-payments-out";
import { getBranding } from "@/lib/dal/settings";

export const metadata: Metadata = { title: "Check details" };
export const dynamic = "force-dynamic";

/** Everything needed to write a check by hand. This is not check printing. */
export default async function CheckDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/payables/payments/${id}/check`);
  const [c, branding] = await Promise.all([guarded(() => getCheckDetails(ctx, id)), getBranding()]);
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href={`/finance/payables/payments/${id}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Back to the payment</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Check details</h1>
            <p className="mt-1 text-sm text-stone-500">Copy these onto a check. We don&apos;t print checks.</p>
          </div>
          <PrintButton />
        </div>
      </div>
      {c.voided ? <p className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-sm text-rose-900 print:hidden">This payment was voided. Don&apos;t write this check.</p> : null}
      <Card className="mx-auto max-w-2xl print:border-black print:shadow-none" data-testid="check-sheet">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">{branding.orgName}</p>
        <dl className="mt-4 space-y-5 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Date</dt>
            <dd className="mt-0.5 text-base font-semibold">{fmtDay(c.date)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Pay to the order of</dt>
            <dd className="mt-0.5 text-lg font-bold">{c.payeeName}</dd>
            {c.addressLines.length ? (
              <dd className="mt-1 text-stone-600">
                {c.addressLines.map((l) => (
                  <span key={l} className="block">
                    {l}
                  </span>
                ))}
              </dd>
            ) : (
              <dd className="mt-1 text-xs text-amber-800 print:hidden">No mailing address on file for this payee.</dd>
            )}
          </div>
          <div className="flex flex-col gap-1 border-y border-line py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Amount in words</dt>
              <dd className="mt-0.5 break-words text-base font-semibold" data-testid="amount-words">{c.amountWords}</dd>
            </div>
            <div className="shrink-0">
              <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400 sm:text-right">Amount</dt>
              <dd className="mt-0.5 text-2xl font-bold tabular-nums">{money(c.amountCents)}</dd>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Memo</dt>
              <dd className="mt-0.5 break-words">{c.memo || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Check number</dt>
              <dd className="mt-0.5">{c.checkNumber ?? "—"}</dd>
            </div>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">Drawn on</dt>
            <dd className="mt-0.5">{c.accountName}</dd>
          </div>
        </dl>
        {c.bills.length > 1 ? (
          <div className="mt-5 border-t border-line pt-4 text-xs text-stone-600">
            <p className="font-semibold">Pays {c.bills.length} bills</p>
            <ul className="mt-1 space-y-0.5">
              {c.bills.map((b, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="break-words">{b.vendorInvoiceNumber ? `#${b.vendorInvoiceNumber} ` : ""}{b.memo}</span>
                  <span className="tabular-nums">{money(b.amountCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
