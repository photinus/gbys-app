import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { InvoiceForm } from "@/components/finance/receivables/invoice-form";
import { loadInvoiceFormOptions } from "@/components/finance/receivables/form-options";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "New invoice" };
export const dynamic = "force-dynamic";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const ctx = await requireSession("/finance/receivables/new");
  const sp = await searchParams;
  const options = await guarded(() => loadInvoiceFormOptions(ctx));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/receivables" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Invoices</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">New invoice</h1>
        <p className="mt-1 text-sm text-stone-500">Save a draft to keep working on it, or issue it when it is ready to send.</p>
      </div>
      <Card>
        <InvoiceForm options={options} today={laToday()} presetContactId={sp.customer} />
      </Card>
    </div>
  );
}
