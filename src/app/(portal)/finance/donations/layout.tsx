import type { ReactNode } from "react";
import { DonationsNav } from "@/components/finance/donations/donations-nav";
import { guarded } from "@/components/finance/gl/guard";
import { requireSession } from "@/lib/dal/context";
import { requireFinance } from "@/lib/dal/finance-access";

/** Donations area: org-wide finance readers only (pages re-check through the DAL). */
export default async function DonationsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireSession("/finance/donations");
  await guarded(() => requireFinance(ctx, "view_all"));
  return (
    <div className="space-y-6">
      <div className="space-y-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Donations</h1>
          <p className="mt-1 text-sm text-stone-500">Record gifts, thank donors with IRS-ready receipts, and track money donors have restricted.</p>
        </div>
        <DonationsNav />
      </div>
      {children}
    </div>
  );
}
