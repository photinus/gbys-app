import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { guarded } from "@/components/finance/gl/guard";
import { InvoiceForm } from "@/components/finance/receivables/invoice-form";
import { loadInvoiceFormOptions } from "@/components/finance/receivables/form-options";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getInvoice } from "@/lib/dal/finance-invoices";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "Edit invoice" };
export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/receivables/${id}/edit`);
  const { options, invoice } = await guarded(async () => ({ options: await loadInvoiceFormOptions(ctx), invoice: await getInvoice(ctx, id) }));
  if (invoice.status !== "draft") redirect(`/finance/receivables/${id}`);
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/finance/receivables/${id}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Invoice #{invoice.number}</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Edit draft invoice #{invoice.number}</h1>
        <p className="mt-1 text-sm text-stone-500">Drafts can be changed freely. Once issued, an invoice can't be edited.</p>
      </div>
      <Card>
        <InvoiceForm
          options={options}
          today={laToday()}
          initial={{
            id: invoice.id,
            number: invoice.number,
            contactId: invoice.contactId,
            issueDate: invoice.issueDate,
            dueDate: invoice.dueDate,
            memo: invoice.memo,
            lines: invoice.lines.map((l) => ({ description: l.description, accountId: l.accountId, fundId: l.fundId, programId: l.programId, amountCents: l.amountCents })),
          }}
        />
      </Card>
    </div>
  );
}
