import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LedgerView } from "@/components/payments-ledger/ledger-view";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import { listLedger, listLedgerPrograms, parseLedgerFilter } from "@/lib/dal/payments-ledger";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string; from?: string; to?: string; kind?: string; cursor?: string }>;
}) {
  const ctx = await requireSession("/admin/payments");
  if (!isBoard(ctx)) notFound();
  const sp = await searchParams;
  const filter = parseLedgerFilter(sp);
  let page;
  try {
    page = await listLedger(ctx, { ...filter, cursor: sp.cursor ?? null });
  } catch (e) {
    if (e instanceof DalError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  const programs = await listLedgerPrograms(ctx);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Payments</h1>
        <p className="mt-1 text-sm text-stone-500">
          Board-wide payment ledger: card payments, refunds, disputes and offline payments across every program. Dates are Pacific time.
        </p>
      </div>
      <LedgerView
        page={page}
        filter={filter}
        basePath="/admin/payments"
        exportPath="/admin/payments/export"
        programs={programs}
        showProgram={!filter.programId}
        cursor={sp.cursor}
      />
    </div>
  );
}
