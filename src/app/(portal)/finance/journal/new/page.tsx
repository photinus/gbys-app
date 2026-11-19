import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { EntryForm } from "@/components/finance/gl/entry-form";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { requireFinance } from "@/lib/dal/finance-access";
import { getPostingOptions } from "@/lib/dal/finance-accounts";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "New journal entry" };
export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const ctx = await requireSession("/finance/journal/new");
  const options = await guarded(async () => {
    await requireFinance(ctx, "edit");
    return getPostingOptions(ctx);
  });
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/journal" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Journal</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">New journal entry</h1>
        <p className="mt-1 text-sm text-stone-500">
          For money that didn&apos;t come through the bank feed or a registration, such as a donated item or a correction. Bank transactions are
          categorized from the bank inbox instead.
        </p>
      </div>
      <Card>
        <EntryForm options={options} today={laToday()} />
      </Card>
    </div>
  );
}
