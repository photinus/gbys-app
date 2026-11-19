import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { PrintButton } from "@/components/finance/reports/print-button";
import { requireSession } from "@/lib/dal/context";
import { getInvoice } from "@/lib/dal/finance-invoices";
import { getBranding } from "@/lib/dal/settings";

export const metadata: Metadata = { title: "Invoice (print view)" };
export const dynamic = "force-dynamic";

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/receivables/${id}/print`);
  const inv = await guarded(() => getInvoice(ctx, id));
  const instructions = inv.paymentInstructions;
  if (inv.status === "draft" || inv.status === "void") notFound();
  const branding = await getBranding();
  const c = inv.contact;
  const cityLine = [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="print:hidden flex flex-wrap items-center justify-between gap-2">
        <Link href={`/finance/receivables/${inv.id}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Invoice #{inv.number}</Link>
        <PrintButton />
      </div>
      <article className="rounded-[26px] border border-line/80 bg-white p-6 shadow-card sm:p-10 print:rounded-none print:border-0 print:p-0 print:shadow-none" data-testid="print-invoice-sheet">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {branding.logoUrl ? <img src={branding.logoUrl} alt={branding.orgName} className="mb-2 max-h-16 max-w-[220px]" /> : null}
            <p className="text-lg font-bold">{branding.orgName}</p>
            <p className="text-xs text-stone-500">
              {[branding.legalDesignation, branding.ein ? `EIN ${branding.ein}` : null].filter(Boolean).join(" · ")}
            </p>
            {branding.supportEmail ? <p className="text-xs text-stone-500">{branding.supportEmail}</p> : null}
          </div>
          <div className="sm:text-right">
            <h1 className="text-3xl font-bold tracking-tight">Invoice</h1>
            <p className="text-sm font-semibold">#{inv.number}</p>
            <p className="mt-2 text-xs text-stone-500">Issued {fmtDay(inv.issueDate)}</p>
            <p className="text-xs text-stone-500">Due {inv.dueDate ? fmtDay(inv.dueDate) : "on receipt"}</p>
          </div>
        </header>

        <section className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Billed to</p>
          <p className="font-semibold">{c.name}</p>
          {c.addressLine1 ? <p className="text-sm">{c.addressLine1}</p> : null}
          {c.addressLine2 ? <p className="text-sm">{c.addressLine2}</p> : null}
          {cityLine ? <p className="text-sm">{cityLine}</p> : null}
        </section>

        {inv.memo ? <p className="mt-6 whitespace-pre-line text-sm text-stone-700">{inv.memo}</p> : null}

        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-stone-300 text-left text-xs uppercase tracking-wider text-stone-500">
              <th className="py-2 pr-2 font-semibold">Description</th>
              <th className="py-2 pl-2 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-b border-stone-200 align-top">
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 pl-2 text-right tabular-nums whitespace-nowrap">{money(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="pt-3 pr-2 text-right font-semibold">Total</td>
              <td className="pt-3 pl-2 text-right font-semibold tabular-nums">{money(inv.totalCents)}</td>
            </tr>
            {inv.paidCents > 0 ? (
              <tr>
                <td className="pt-1 pr-2 text-right text-stone-600">Payments received</td>
                <td className="pt-1 pl-2 text-right tabular-nums text-stone-600">-{money(inv.paidCents)}</td>
              </tr>
            ) : null}
            <tr>
              <td className="pt-2 pr-2 text-right text-base font-bold">Balance due</td>
              <td className="pt-2 pl-2 text-right text-base font-bold tabular-nums" data-testid="print-balance">{money(inv.balanceCents)}</td>
            </tr>
          </tfoot>
        </table>

        {instructions ? (
          <section className="mt-8 rounded-xl bg-stone-100 p-4 text-sm print:border print:border-stone-300 print:bg-white">
            <p className="font-semibold">How to pay</p>
            <p className="mt-1 whitespace-pre-line">{instructions}</p>
          </section>
        ) : null}
        <p className="mt-8 text-xs text-stone-400">Please include invoice #{inv.number} with your payment. Thank you!</p>
      </article>
    </div>
  );
}
