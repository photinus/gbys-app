import "server-only";
import type { SessionContext } from "@/lib/dal/context";
import { requireFinance } from "@/lib/dal/finance-access";
import { getPostingOptions } from "@/lib/dal/finance-accounts";
import { listContacts } from "@/lib/dal/finance-contacts";
import type { InvoiceFormOptions } from "./invoice-form";

/** Customers, revenue categories, funds and programs for the invoice form ("edit"). */
export async function loadInvoiceFormOptions(ctx: SessionContext): Promise<InvoiceFormOptions> {
  await requireFinance(ctx, "edit");
  const [opts, customers] = await Promise.all([getPostingOptions(ctx), listContacts(ctx, { role: "customer", limit: 1000 })]);
  return {
    customers: customers.map((c) => ({ id: c.id, name: c.displayName, email: c.email })),
    accounts: (opts.accountGroups.find((g) => g.type === "revenue")?.accounts ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name })),
    funds: opts.funds.map((f) => ({ id: f.id, name: f.name, restricted: f.restriction === "with_donor_restrictions" })),
    programs: opts.programs,
    generalFundId: opts.generalFundId,
  };
}
