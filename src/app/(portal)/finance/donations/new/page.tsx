import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GiftForm } from "@/components/finance/donations/gift-form";
import { guarded } from "@/components/finance/gl/guard";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getBankTxnPrefill, getGiftFormOptions } from "@/lib/dal/finance-donations";
import { getContact } from "@/lib/dal/finance-contacts";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "Record a gift" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function NewGiftPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/donations/new");
  const sp = await searchParams;
  const bankTxnId = one(sp.bankTxn);
  const donorId = one(sp.donor);
  const { options, bankTxn, donor } = await guarded(async () => ({
    options: await getGiftFormOptions(ctx),
    bankTxn: bankTxnId ? await getBankTxnPrefill(ctx, bankTxnId) : null,
    donor: donorId ? await getContact(ctx, donorId).then((c) => ({ id: c.id, name: c.displayName, email: c.email })).catch(() => null) : null,
  }));
  return (
    <div className="space-y-5">
      <Link href="/finance/donations" className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-charcoal">
        <ArrowLeft className="h-4 w-4" /> All gifts
      </Link>
      <h2 className="text-xl font-bold">Record a gift</h2>
      {bankTxnId && !bankTxn ? (
        <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950">
          That bank transaction can&apos;t be used (it&apos;s already handled, or it isn&apos;t a deposit). You can still record the gift without linking it.
        </p>
      ) : null}
      <Card>
        <GiftForm
          options={options}
          today={laToday()}
          initialDonor={donor}
          bankTxn={bankTxn ? { id: bankTxn.id, date: bankTxn.date, amountCents: bankTxn.amountCents, description: bankTxn.payee ?? bankTxn.description } : null}
        />
      </Card>
    </div>
  );
}
