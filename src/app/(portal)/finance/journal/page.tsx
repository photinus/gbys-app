import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { Badge, Button, Card, EmptyState, Input, Select, TBody, TD, TH, THead, TR, Table, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { listAccountChoices } from "@/lib/dal/finance-accounts";
import { listJournalEntries } from "@/lib/dal/finance-journal";
import { ENTRY_SOURCE_LABELS } from "@/lib/validation/finance-gl";
import { isIsoDate } from "@/lib/finance/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Journal" };
export const dynamic = "force-dynamic";

type SP = { from?: string; to?: string; source?: string; account?: string; q?: string; cursor?: string };

export default async function JournalPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireSession("/finance/journal");
  const sp = await searchParams;
  const cursor = Number(sp.cursor);
  const filter = {
    from: sp.from && isIsoDate(sp.from) ? sp.from : null,
    to: sp.to && isIsoDate(sp.to) ? sp.to : null,
    source: sp.source && sp.source in ENTRY_SOURCE_LABELS ? sp.source : null,
    accountId: sp.account && /^[0-9a-f-]{36}$/i.test(sp.account) ? sp.account : null,
    q: sp.q?.trim().slice(0, 100) || null,
    cursor: Number.isInteger(cursor) && cursor > 0 ? cursor : null,
  };
  const { page, accounts, canEdit } = await guarded(async () => ({
    page: await listJournalEntries(ctx, filter),
    accounts: await listAccountChoices(ctx),
    canEdit: canEditBooks(await getFinanceAccess(ctx)),
  }));
  const hasFilter = !!(filter.from || filter.to || filter.source || filter.accountId || filter.q);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ from: filter.from, to: filter.to, source: filter.source, account: filter.accountId, q: filter.q })) {
    if (v) qs.set(k, v);
  }
  const olderHref = page.nextCursor ? `/finance/journal?${new URLSearchParams({ ...Object.fromEntries(qs), cursor: String(page.nextCursor) })}` : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Journal</h1>
          <p className="mt-1 text-sm text-stone-500">
            Every transaction in the books, newest first. Entries are never deleted: a fix voids the old entry and posts a new one.
          </p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/finance/journal/opening-balances" className={buttonStyles({ variant: "secondary", size: "sm" })}>
              Opening balances
            </Link>
            <Link href="/finance/journal/new" className={buttonStyles({ size: "sm" })} data-testid="new-entry">
              <Plus className="h-4 w-4" /> New entry
            </Link>
          </div>
        ) : null}
      </div>

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" data-testid="journal-filters">
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-stone-600" htmlFor="jf-from">From</label>
            <Input id="jf-from" type="date" name="from" defaultValue={filter.from ?? ""} />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-stone-600" htmlFor="jf-to">To</label>
            <Input id="jf-to" type="date" name="to" defaultValue={filter.to ?? ""} />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-stone-600" htmlFor="jf-source">Source</label>
            <Select id="jf-source" name="source" defaultValue={filter.source ?? ""}>
              <option value="">All sources</option>
              {Object.entries(ENTRY_SOURCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-stone-600" htmlFor="jf-account">Account</label>
            <Select id="jf-account" name="account" defaultValue={filter.accountId ?? ""}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </Select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-semibold text-stone-600" htmlFor="jf-q">Search memo</label>
            <Input id="jf-q" name="q" defaultValue={filter.q ?? ""} placeholder="e.g. uniforms" maxLength={100} />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm">Filter</Button>
            {hasFilter ? (
              <Link href="/finance/journal" className={buttonStyles({ variant: "ghost", size: "sm" })}>Clear</Link>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        {page.rows.length === 0 ? (
          <EmptyState
            title={hasFilter ? "No entries match those filters" : "No entries yet"}
            description={hasFilter ? "Try widening the dates or clearing the search." : "Entries appear here as you categorize bank transactions or add your own."}
            action={
              canEdit && !hasFilter ? (
                <Link href="/finance/journal/opening-balances" className={buttonStyles({ size: "sm" })}>Enter opening balances</Link>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-16">#</TH>
                <TH>Date</TH>
                <TH>Memo</TH>
                <TH>Source</TH>
                <TH className="text-right">Amount</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {page.rows.map((r) => (
                <TR key={r.id} className={cn(r.voidedAt && "bg-stone-50/60 text-stone-400")} data-testid="journal-row">
                  <TD className="tabular-nums">
                    <Link href={`/finance/journal/${r.id}`} className="font-semibold text-indigo-700 hover:underline">
                      {r.entryNumber}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap">{fmtDay(r.entryDate)}</TD>
                  <TD className={cn("max-w-[320px]", r.voidedAt && "line-through decoration-stone-300")}>
                    <Link href={`/finance/journal/${r.id}`} className="block truncate hover:underline">{r.memo}</Link>
                  </TD>
                  <TD className="whitespace-nowrap text-xs">{ENTRY_SOURCE_LABELS[r.source] ?? r.source}</TD>
                  <TD className="text-right tabular-nums">{money(r.totalCents)}</TD>
                  <TD className="text-xs">
                    {r.voidedAt ? (
                      <span>
                        <Badge tone="neutral">Voided</Badge>
                        <span className="mt-1 block max-w-[220px] truncate" title={r.voidReason ?? ""}>
                          {r.replacedByNumber ? `Replaced by #${r.replacedByNumber}. ` : ""}
                          {r.voidReason}
                        </span>
                      </span>
                    ) : (
                      <Badge tone="success">Posted</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {olderHref ? (
          <div className="mt-4 flex justify-center">
            <Link href={olderHref} className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="older-entries">
              Show older entries
            </Link>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
