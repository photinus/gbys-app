import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LedgerView } from "@/components/payments-ledger/ledger-view";
import { DalError, requireSession } from "@/lib/dal/context";
import { getLedgerProgram, listLedger, parseLedgerFilter } from "@/lib/dal/payments-ledger";

export const metadata: Metadata = { title: "Payments Ledger" };
export const dynamic = "force-dynamic";

export default async function ProgramLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; kind?: string; cursor?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const base = `/programs/${slug}/payments/ledger`;
  const ctx = await requireSession(base);
  let program;
  let page;
  const filter = parseLedgerFilter(sp);
  try {
    program = await getLedgerProgram(ctx, slug);
    filter.programId = program.id;
    page = await listLedger(ctx, { ...filter, cursor: sp.cursor ?? null });
  } catch (e) {
    if (e instanceof DalError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="min-w-0">
        <Link href={`/programs/${slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          ← {program.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Payments ledger</h1>
        <p className="mt-1 text-sm text-stone-500">
          Every card payment, refund, dispute and offline payment for this program. The ledger is append-only; dates are Pacific time.
        </p>
      </div>
      <LedgerView
        page={page}
        filter={filter}
        basePath={base}
        exportPath={`${base}/export`}
        showProgram={false}
        cursor={sp.cursor}
      />
    </div>
  );
}
