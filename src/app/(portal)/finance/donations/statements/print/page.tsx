import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { ReceiptPrintActions } from "@/components/finance/donations/receipt-print-actions";
import { ReceiptView } from "@/components/finance/donations/receipt-view";
import { guarded } from "@/components/finance/gl/guard";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { requireSession } from "@/lib/dal/context";
import { getAnnualPrintBatch, getAnnualStatementDoc, type AnnualPrintFilter } from "@/lib/dal/finance-receipts";
import { laToday } from "@/lib/finance/dates";
import type { ReceiptDoc } from "@/lib/finance/receipt-content";

export const metadata: Metadata = { title: "Print statements" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

/** Printable batch: one yearly statement per page (page break after each). `?donor=` prints a single donor. */
export default async function PrintStatementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireSession("/finance/donations/statements/print");
  const y = Number(one(sp.year));
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : Number(laToday().slice(0, 4));
  const donor = one(sp.donor);
  const filter = (["all", "needing", "no_email"].includes(one(sp.filter) ?? "") ? one(sp.filter) : "all") as AnnualPrintFilter;
  const { docs, canEdit } = await guarded(async () => {
    const canEdit = canEditBooks(await getFinanceAccess(ctx));
    if (donor) {
      const one = await getAnnualStatementDoc(ctx, donor, year);
      return { docs: [{ contactId: donor, doc: one.doc }] as { contactId: string; doc: ReceiptDoc }[], canEdit };
    }
    return { docs: (await getAnnualPrintBatch(ctx, year, filter)).docs, canEdit };
  });
  const warnings = [...new Set(docs.flatMap((d) => d.doc.warnings.filter((w) => !w.includes("mailing address"))))];
  const noAddress = docs.filter((d) => d.doc.addressLines.length === 0).map((d) => d.doc.donor.name);
  return (
    <div className="space-y-4">
      <div className="print:hidden space-y-3">
        <Link href={`/finance/donations/statements?year=${year}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-charcoal">
          <ArrowLeft className="h-4 w-4" /> Yearly statements
        </Link>
        <h2 className="text-xl font-bold" data-testid="print-title">
          {year} statements · {docs.length} letter{docs.length === 1 ? "" : "s"}
        </h2>
        {warnings.length || noAddress.length ? (
          <div className="rounded-xl bg-amber-soft/40 px-4 py-3 text-xs text-amber-950">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-4 w-4" /> Before you print
            </p>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
              {noAddress.length ? <li>{noAddress.length} donor{noAddress.length === 1 ? " has" : "s have"} no mailing address: {noAddress.slice(0, 5).join(", ")}{noAddress.length > 5 ? "…" : ""}</li> : null}
            </ul>
          </div>
        ) : null}
        {docs.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing to print for this selection.</p>
        ) : (
          <ReceiptPrintActions target={{ kind: "annual", year, contactIds: docs.map((d) => d.contactId) }} canMark={canEdit} />
        )}
      </div>
      <div className="space-y-6 print:space-y-0">
        {docs.map((d, i) => (
          <div key={d.contactId} className={i < docs.length - 1 ? "print:break-after-page" : undefined} data-testid="statement-page">
            <ReceiptView doc={d.doc} />
          </div>
        ))}
      </div>
    </div>
  );
}
