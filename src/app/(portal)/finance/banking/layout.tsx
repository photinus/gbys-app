import type { ReactNode } from "react";
import { BankingNav } from "@/components/finance/banking/banking-nav";

/** Banking area chrome. Pages authorize through the DAL and 404 on FORBIDDEN. */
export default function BankingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Banking</h1>
        <p className="mt-1 text-sm text-stone-500">
          Review money going in and out of the bank, sort it into categories, and check it against your statements.
        </p>
      </div>
      <BankingNav />
      {children}
    </div>
  );
}
