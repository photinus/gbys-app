import type { Metadata } from "next";
import Link from "next/link";
import { ReimbursementForm } from "@/components/finance/payables/reimbursement-form";
import { Card } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getReimbursementOptions } from "@/lib/dal/finance-bills";
import { laToday } from "@/lib/finance/dates";

export const metadata: Metadata = { title: "New reimbursement claim" };
export const dynamic = "force-dynamic";

export default async function NewClaimPage() {
  const ctx = await requireSession("/reimbursements/new");
  const options = await getReimbursementOptions(ctx);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/reimbursements" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Reimbursements</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">New reimbursement claim</h1>
        <p className="mt-1 text-sm text-stone-500">Tell us what you paid for and attach your receipt. A board member will review it.</p>
      </div>
      <Card>
        <ReimbursementForm options={options} today={laToday()} />
      </Card>
    </div>
  );
}
