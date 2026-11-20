import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GiftForm } from "@/components/finance/donations/gift-form";
import { guarded } from "@/components/finance/gl/guard";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getContact } from "@/lib/dal/finance-contacts";
import { getGiftForEdit, getGiftFormOptions } from "@/lib/dal/finance-donations";
import { laToday } from "@/lib/finance/dates";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Edit gift" };
export const dynamic = "force-dynamic";

export default async function EditGiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/donations/${id}/edit`);
  const { initial, options, donor } = await guarded(async () => {
    const initial = await getGiftForEdit(ctx, id);
    return {
      initial,
      options: await getGiftFormOptions(ctx),
      donor: initial.donorContactId ? await getContact(ctx, initial.donorContactId).then((c) => ({ id: c.id, name: c.displayName, email: c.email })) : null,
    };
  });
  if (initial.voided) notFound();
  return (
    <div className="space-y-5">
      <Link href={`/finance/donations/${id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-charcoal">
        <ArrowLeft className="h-4 w-4" /> Back to the gift
      </Link>
      <h2 className="text-xl font-bold">Edit gift</h2>
      <p className="text-sm text-stone-500">
        Saving replaces the gift&apos;s journal entry (the old one is voided and linked). The receipt history stays with the gift.
      </p>
      <Card>
        <GiftForm options={options} today={laToday()} initial={initial} initialDonor={donor} />
      </Card>
    </div>
  );
}
