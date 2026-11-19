import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { PayForm } from "@/components/finance/payables/pay-form";
import { Card } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getBankTxnPrefill, getPaymentOptions, listOpenBillsForPayment } from "@/lib/dal/finance-payments-out";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "Pay bills" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** ?bill=<id> | ?bills=<id,id> | ?contact=<id> | ?bankTxn=<id> prefill the form. */
export default async function PayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/payables/pay");
  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const billIds = [one("bill"), ...(one("bills")?.split(",") ?? [])].filter((x): x is string => !!x && UUID.test(x));
  const contact = one("contact") && UUID.test(one("contact")!) ? one("contact") : undefined;
  const bankTxnId = one("bankTxn");
  const bankProblem: { text: string | null } = { text: null };
  const data = await guarded(async () => ({
    openBills: await listOpenBillsForPayment(ctx),
    options: await getPaymentOptions(ctx),
    // An already-handled transaction (e.g. the page re-rendering right after a successful payment) is a notice, not an error.
    bankTxn: bankTxnId
      ? await getBankTxnPrefill(ctx, bankTxnId).catch((e) => {
          if (e instanceof DalError && e.code === "INVALID") {
            bankProblem.text = e.message;
            return undefined;
          }
          throw e;
        })
      : undefined,
  }));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/payables" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Bills &amp; payables</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Pay bills</h1>
        <p className="mt-1 text-sm text-stone-500">Pick who you&apos;re paying, tick the bills this payment covers, and say how it was paid. You can pay part of a bill.</p>
      </div>
      {bankProblem.text ? (
        <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950">{bankProblem.text} You can still record a payment without linking it.</p>
      ) : null}
      <Card>
        <PayForm openBills={data.openBills} options={data.options} today={laToday()} initialContactId={contact} initialBillIds={billIds} bankTxn={data.bankTxn} />
      </Card>
    </div>
  );
}
