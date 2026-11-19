import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay } from "@/components/finance/gl/format";
import { OpeningBalancesForm } from "@/components/finance/gl/opening-balances-form";
import { Card, CardHeader } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { requireFinance } from "@/lib/dal/finance-access";
import { getPostingOptions } from "@/lib/dal/finance-accounts";
import { listOpeningBalanceEntries } from "@/lib/dal/finance-journal";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "Opening balances" };
export const dynamic = "force-dynamic";

export default async function OpeningBalancesPage() {
  const ctx = await requireSession("/finance/journal/opening-balances");
  const { options, existing } = await guarded(async () => {
    await requireFinance(ctx, "edit");
    return { options: await getPostingOptions(ctx), existing: await listOpeningBalanceEntries(ctx) };
  });
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/journal" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Journal</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Opening balances</h1>
        <p className="mt-1 text-sm text-stone-500">
          Tell the books what you owned and owed on the day you start. Grab the balances from your last bank statements.
        </p>
      </div>
      {existing.length ? (
        <p className="rounded-2xl bg-amber-soft/40 px-4 py-3 text-xs text-amber-950" data-testid="existing-opening">
          Opening balances were already entered:{" "}
          {existing.map((e, i) => (
            <span key={e.id}>
              {i ? ", " : ""}
              <Link href={`/finance/journal/${e.id}`} className="font-semibold underline">
                #{e.entryNumber} ({fmtDay(e.entryDate)})
              </Link>
            </span>
          ))}
          . Posting again adds to them. To correct one, open it and choose Edit.
        </p>
      ) : null}
      <Card>
        <CardHeader title="Balances" description="Only fill in the accounts that have a balance." />
        <OpeningBalancesForm options={options} today={laToday()} />
      </Card>
    </div>
  );
}
