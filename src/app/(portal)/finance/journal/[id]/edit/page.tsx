import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guarded } from "@/components/finance/gl/guard";
import { EntryForm } from "@/components/finance/gl/entry-form";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { requireFinance } from "@/lib/dal/finance-access";
import { getPostingOptions } from "@/lib/dal/finance-accounts";
import { getJournalEntry } from "@/lib/dal/finance-journal";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "Edit journal entry" };
export const dynamic = "force-dynamic";

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/journal/${id}/edit`);
  const { entry, options } = await guarded(async () => {
    await requireFinance(ctx, "edit");
    return { entry: await getJournalEntry(ctx, id), options: await getPostingOptions(ctx) };
  });
  if (!entry.editable) notFound();
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/finance/journal/${entry.id}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Entry #{entry.entryNumber}</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Edit entry #{entry.entryNumber}</h1>
        <p className="mt-1 text-sm text-stone-500">
          Saving voids entry #{entry.entryNumber} and posts a corrected entry that links back to it, so there is always a clear history.
        </p>
      </div>
      <Card>
        <EntryForm
          options={options}
          today={laToday()}
          initial={{
            entryId: entry.id,
            entryNumber: entry.entryNumber,
            entryDate: entry.entryDate,
            memo: entry.memo,
            lines: entry.lines.map((l) => ({
              accountId: l.accountId,
              fundId: l.fundId,
              programId: l.programId,
              debitCents: l.debitCents,
              creditCents: l.creditCents,
              description: l.description,
            })),
          }}
        />
      </Card>
    </div>
  );
}
