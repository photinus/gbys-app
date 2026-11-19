import type { ReactNode } from "react";
import { formatCents } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Plain-language names for account types. */
export const TYPE_LABELS: Record<string, string> = {
  revenue: "Income",
  expense: "Expenses",
  asset: "Assets",
  liability: "Liabilities",
  net_assets: "Net assets",
};

/** Display order of category groups for money in vs money out. */
export function typeOrder(deposit: boolean): string[] {
  return deposit
    ? ["revenue", "liability", "asset", "net_assets", "expense"]
    : ["expense", "liability", "asset", "net_assets", "revenue"];
}

export interface CategoryOption {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string | null;
}

/** <optgroup>s of categories, ordered for the direction of the money. */
export function CategoryOptions({ categories, deposit }: { categories: CategoryOption[]; deposit: boolean }): ReactNode {
  return typeOrder(deposit).map((t) => {
    const list = categories.filter((c) => c.type === t);
    if (list.length === 0) return null;
    return (
      <optgroup key={t} label={TYPE_LABELS[t] ?? t}>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} {c.name}
          </option>
        ))}
      </optgroup>
    );
  });
}

/** "$12.34" in green for money in, "-$12.34" in red for money out. */
export function Amount({ cents, className, caption = true }: { cents: number; className?: string; caption?: boolean }) {
  const inbound = cents > 0;
  return (
    <div className={cn("text-right", className)}>
      <div className={cn("font-semibold tabular-nums", inbound ? "text-emerald-700" : "text-rose-700")}>
        {inbound ? "+" : "-"}
        {formatCents(Math.abs(cents))}
      </div>
      {caption ? <div className="text-[11px] text-stone-400">{inbound ? "Money in" : "Money out"}</div> : null}
    </div>
  );
}

/** Date-only string -> something formatDate() renders without a timezone shift. */
export function dateOnly(d: string): string {
  return `${d}T12:00:00`;
}

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual entry",
  opening_balance: "Opening balance",
  bank: "Bank transaction",
  transfer: "Transfer",
  registration: "Registration",
  stripe_fee: "Stripe fees",
  stripe_payout: "Stripe payout",
  platform_fee: "Platform fee",
  bill: "Bill",
  bill_payment: "Bill payment",
  invoice: "Invoice",
  invoice_payment: "Invoice payment",
  donation: "Donation",
  reimbursement: "Reimbursement",
  fund_release: "Fund release",
};
