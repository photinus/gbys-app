import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { BillForm } from "@/components/finance/payables/bill-form";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getBillOptions } from "@/lib/dal/finance-bills";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "New bill" };
export const dynamic = "force-dynamic";

export default async function NewBillPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/payables/new");
  const sp = await searchParams;
  const contact = typeof sp.contact === "string" && /^[0-9a-f-]{36}$/i.test(sp.contact) ? sp.contact : undefined;
  const options = await guarded(() => getBillOptions(ctx));
  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/payables" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Bills &amp; payables</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">New bill</h1>
        <p className="mt-1 text-sm text-stone-500">
          Enter a bill from a vendor. Save it as a draft, or submit it so someone else can approve it. It is added to the books once approved.
        </p>
      </div>
      <Card>
        <BillForm options={options} today={laToday()} defaultContactId={contact} />
      </Card>
    </div>
  );
}
