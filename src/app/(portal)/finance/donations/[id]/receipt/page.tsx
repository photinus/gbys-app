import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { ReceiptPrintActions } from "@/components/finance/donations/receipt-print-actions";
import { ReceiptView } from "@/components/finance/donations/receipt-view";
import { guarded } from "@/components/finance/gl/guard";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { getGiftReceiptPreview } from "@/lib/dal/finance-receipts";
import { DalError } from "@/lib/dal/context";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

export default async function GiftReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/donations/${id}/receipt`);
  let preview;
  try {
    preview = await guarded(() => getGiftReceiptPreview(ctx, id));
  } catch (e) {
    if (e instanceof DalError && e.code === "INVALID") {
      return (
        <div className="space-y-4">
          <Link href={`/finance/donations/${id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-charcoal">
            <ArrowLeft className="h-4 w-4" /> Back to the gift
          </Link>
          <p className="rounded-xl bg-amber-soft/40 px-4 py-3 text-sm text-amber-950">{e.message}</p>
        </div>
      );
    }
    throw e;
  }
  if (!preview) notFound();
  return (
    <div className="space-y-4">
      <div className="print:hidden space-y-3">
        <Link href={`/finance/donations/${id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-charcoal">
          <ArrowLeft className="h-4 w-4" /> Back to the gift
        </Link>
        {preview.doc.warnings.length ? (
          <div className="rounded-xl bg-amber-soft/40 px-4 py-3 text-xs text-amber-950" data-testid="receipt-warnings">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4" /> Before you send or print
            </p>
            <ul className="mt-1 list-disc pl-5">
              {preview.doc.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <ReceiptPrintActions target={{ kind: "gift", giftId: id }} canMark={canEditBooks(await getFinanceAccess(ctx))} />
      </div>
      <ReceiptView doc={preview.doc} />
    </div>
  );
}
