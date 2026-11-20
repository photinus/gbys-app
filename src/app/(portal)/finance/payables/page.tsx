import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { BillsList } from "@/components/finance/payables/bills-list";
import { Button, Card, Input, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { billGroupCounts, countMyApprovals, listBills, type BillGroup } from "@/lib/dal/finance-bills";
import { canApproveBills, canEditBooks, canViewAllFinance, getFinanceAccess } from "@/lib/dal/finance-access";
import { contactNames } from "@/lib/dal/finance-contacts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bills & payables" };
export const dynamic = "force-dynamic";

const GROUPS: { key: BillGroup; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Waiting for approval" },
  { key: "unpaid", label: "To pay" },
  { key: "paid", label: "Paid" },
  { key: "drafts", label: "Drafts & sent back" },
  { key: "void", label: "Void" },
];

type Sp = Record<string, string | string[] | undefined>;
const one = (sp: Sp, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) || undefined;
};

export default async function PayablesPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const ctx = await requireSession("/finance/payables");
  const sp = await searchParams;
  const group = (GROUPS.find((g) => g.key === one(sp, "group"))?.key ?? "all") as BillGroup;
  const q = one(sp, "q");
  const rawContact = one(sp, "contact");
  const contact = rawContact && /^[0-9a-f-]{36}$/i.test(rawContact) ? rawContact : undefined;
  const overdue = one(sp, "overdue") === "1";
  const data = await guarded(async () => {
    const a = await getFinanceAccess(ctx);
    const [rows, counts, mine] = await Promise.all([
      listBills(ctx, { group, q, contactId: contact, overdue }),
      billGroupCounts(ctx),
      countMyApprovals(ctx),
    ]);
    const names = contact && canViewAllFinance(a) ? await contactNames([contact]) : new Map<string, string>();
    return { a, rows, counts, mine, contactName: contact ? (names.get(contact) ?? null) : null };
  });
  const { a } = data;
  const canCreate = canEditBooks(a) || a.programs.some((p) => p.role === "editor");
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { group: group === "all" ? undefined : group, q, contact, overdue: overdue ? "1" : undefined, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/finance/payables?${s}` : "/finance/payables";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Bills &amp; payables</h1>
          <p className="mt-1 text-sm text-stone-500">Bills we owe, reimbursements for members, and the payments that settle them.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate ? (
            <Link href="/finance/payables/new" className={buttonStyles({})} data-testid="new-bill">
              New bill
            </Link>
          ) : null}
          {canEditBooks(a) ? (
            <Link href="/finance/payables/pay" className={buttonStyles({ variant: "secondary" })} data-testid="pay-bills">
              Pay bills
            </Link>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        {canApproveBills(a) ? (
          <Link href="/finance/payables/approvals" className={buttonStyles({ variant: data.mine > 0 ? "primary" : "secondary", size: "sm" })} data-testid="approvals-link">
            Waiting for my approval{data.mine > 0 ? ` (${data.mine})` : ""}
          </Link>
        ) : null}
        {canViewAllFinance(a) ? (
          <>
            <Link href="/finance/payables/payments" className={buttonStyles({ variant: "secondary", size: "sm" })}>
              Payments made
            </Link>
            <Link href="/finance/contacts?role=vendor" className={buttonStyles({ variant: "secondary", size: "sm" })}>
              Vendors &amp; contacts
            </Link>
            <Link href="/finance/reports/ap-aging" className={buttonStyles({ variant: "secondary", size: "sm" })}>
              A/P aging
            </Link>
          </>
        ) : null}
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter bills">
          {GROUPS.map((g) => (
            <Link
              key={g.key}
              href={href({ group: g.key === "all" ? undefined : g.key })}
              className={buttonStyles({ variant: g.key === group ? "primary" : "secondary", size: "sm" })}
            >
              {g.label} <span className={cn("tabular-nums", g.key === group ? "text-white/70" : "text-stone-400")}>{data.counts[g.key]}</span>
            </Link>
          ))}
        </div>
        <form method="get" action="/finance/payables" className="mb-4 flex flex-col gap-2 sm:flex-row">
          {group !== "all" ? <input type="hidden" name="group" value={group} /> : null}
          {contact ? <input type="hidden" name="contact" value={contact} /> : null}
          <Input name="q" defaultValue={q} placeholder="Search payee, description or invoice number" aria-label="Search bills" className="sm:max-w-sm" />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
          <Link href={href({ overdue: overdue ? undefined : "1" })} className={buttonStyles({ variant: overdue ? "primary" : "secondary", size: "sm" })}>
            {overdue ? "Showing overdue only" : "Overdue only"}
          </Link>
        </form>
        {data.contactName ? (
          <p className="mb-3 text-sm text-stone-600">
            Showing bills for <strong>{data.contactName}</strong>.{" "}
            <Link href={href({ contact: undefined })} className="font-semibold underline">
              Show everyone
            </Link>
          </p>
        ) : null}
        <BillsList rows={data.rows} />
      </Card>
    </div>
  );
}
