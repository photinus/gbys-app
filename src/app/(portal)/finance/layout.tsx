import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal/context";
import { getFinanceAccess, hasFinanceAccess } from "@/lib/dal/finance-access";

/** Finance area gate: any finance access (org-wide or program-scoped). Pages re-check via the DAL. */
export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const ctx = await requireSession("/finance");
  if (!hasFinanceAccess(await getFinanceAccess(ctx))) notFound();
  return <>{children}</>;
}
