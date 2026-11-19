import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guarded } from "@/components/finance/gl/guard";
import { BillForm } from "@/components/finance/payables/bill-form";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getBill, getBillOptions } from "@/lib/dal/finance-bills";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "Edit bill" };
export const dynamic = "force-dynamic";

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/payables/${id}/edit`);
  const { bill, options } = await guarded(async () => ({ bill: await getBill(ctx, id), options: await getBillOptions(ctx) }));
  if (!bill.viewer.canEdit) notFound();
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/finance/payables/${id}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Back to the bill</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{bill.status === "rejected" ? "Fix and resubmit" : "Edit draft"}</h1>
        {bill.status === "rejected" && bill.rejectedReason ? (
          <p className="mt-2 rounded-xl bg-coral/25 px-3.5 py-2.5 text-sm text-rose-900">
            <strong>Sent back:</strong> {bill.rejectedReason}
          </p>
        ) : null}
      </div>
      <Card>
        <BillForm
          options={options}
          today={laToday()}
          initial={{
            id: bill.id,
            contactId: bill.contactId,
            vendorInvoiceNumber: bill.vendorInvoiceNumber,
            programId: bill.programId,
            billDate: bill.billDate,
            dueDate: bill.dueDate,
            memo: bill.memo,
            lines: bill.lines,
          }}
        />
      </Card>
    </div>
  );
}
