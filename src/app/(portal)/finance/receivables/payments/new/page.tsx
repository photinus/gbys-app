import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { PaymentForm } from "@/components/finance/receivables/payment-form";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getReceivePaymentFormData } from "@/lib/dal/finance-payments-in";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "Receive payment" };
export const dynamic = "force-dynamic";

export default async function ReceivePaymentPage({ searchParams }: { searchParams: Promise<{ bankTxn?: string; invoice?: string }> }) {
  const ctx = await requireSession("/finance/receivables/payments/new");
  const sp = await searchParams;
  const data = await guarded(() => getReceivePaymentFormData(ctx, sp.bankTxn));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/receivables" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Invoices</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Receive payment</h1>
        <p className="mt-1 text-sm text-stone-500">
          Record money a customer paid. One payment can cover several invoices from the same customer.
        </p>
      </div>
      <Card>
        <PaymentForm data={data} today={laToday()} presetInvoiceId={sp.invoice} />
      </Card>
    </div>
  );
}
