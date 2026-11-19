import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { guard } from "@/components/finance/banking/guard";
import { InboxList } from "@/components/finance/banking/inbox-list";
import { SyncButton } from "@/components/finance/banking/sync-button";
import { requireSession } from "@/lib/dal/context";
import { getBankingOptions, getBankingOverview, listInbox } from "@/lib/dal/finance-banking";
import { formatDateTime } from "@/lib/format";
import { INBOX_TABS, type InboxTab } from "@/lib/validation/finance-banking";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bank inbox" };
export const dynamic = "force-dynamic";

const TAB_LABELS: Record<InboxTab, string> = { new: "New", posted: "Posted", excluded: "Excluded" };

function href(tab: InboxTab, account: string | undefined, page?: number) {
  const q = new URLSearchParams();
  if (tab !== "new") q.set("tab", tab);
  if (account) q.set("account", account);
  if (page && page > 1) q.set("page", String(page));
  const s = q.toString();
  return `/finance/banking${s ? `?${s}` : ""}`;
}

export default async function BankingInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; account?: string; page?: string }>;
}) {
  const ctx = await requireSession("/finance/banking");
  const sp = await searchParams;
  const tab: InboxTab = (INBOX_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as InboxTab) : "new";
  const account = sp.account && /^[0-9a-f-]{36}$/i.test(sp.account) ? sp.account : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [inbox, options, overview] = await guard(() =>
    Promise.all([listInbox(ctx, { tab, bankAccountId: account, page }), getBankingOptions(ctx), getBankingOverview(ctx)])
  );
  const lastSync = overview.connections.map((c) => c.lastSyncAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  const problems = overview.connections.filter((c) => c.lastSyncStatus && c.lastSyncStatus !== "ok");
  const unmapped = overview.accounts.filter((a) => !a.glAccountId);
  const lastPage = Math.max(1, Math.ceil(inbox.total / inbox.pageSize));

  return (
    <div className="space-y-5">
      {overview.connections.length === 0 ? (
        <EmptyState
          title="Connect your bank to get started"
          description="GBYS uses SimpleFIN to read your bank's transactions (read-only). A finance admin can connect it in a few minutes."
          action={
            <Link href="/finance/banking/accounts" className={buttonStyles({ size: "sm" })}>
              Set up bank connection
            </Link>
          }
        />
      ) : (
        <Card className="space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone-600" data-testid="last-synced">
              {lastSync ? `Last synced ${formatDateTime(lastSync)}` : "Not synced yet"}
              {overview.connections.length > 1 ? ` · ${overview.connections.length} connections` : ""}
            </p>
            {overview.canEdit ? <SyncButton /> : null}
          </div>
          {problems.length > 0 ? (
            <div role="status" className="rounded-xl bg-amber-soft/30 px-3.5 py-2.5 text-xs text-amber-950">
              {problems.map((c) => (
                <p key={c.id}>
                  <strong>{c.label}:</strong> {c.lastSyncMessages.join(" ") || "The last sync had a problem."}
                </p>
              ))}
            </div>
          ) : null}
          {unmapped.length > 0 ? (
            <p className="text-xs text-stone-600">
              {unmapped.length} bank account{unmapped.length === 1 ? " isn't" : "s aren't"} importing yet.{" "}
              <Link href="/finance/banking/accounts" className="font-semibold text-charcoal underline">
                Choose where {unmapped.length === 1 ? "it" : "they"} should post.
              </Link>
            </p>
          ) : null}
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Transaction status" className="flex gap-1.5 overflow-x-auto">
            {INBOX_TABS.map((t) => (
              <Link
                key={t}
                role="tab"
                aria-selected={t === tab}
                href={href(t, account)}
                data-testid={`tab-${t}`}
                className={cn(
                  "inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                  t === tab ? "bg-charcoal text-white" : "bg-alabaster text-stone-600 hover:text-charcoal"
                )}
              >
                {TAB_LABELS[t]}
                <Badge tone={t === tab ? "neutral" : "info"} className="px-2 py-0.5 text-[11px]" data-testid={`count-${t}`}>
                  {inbox.counts[t]}
                </Badge>
              </Link>
            ))}
          </div>
          {inbox.accounts.length > 1 ? (
            <form method="get" className="flex items-center gap-2">
              {tab !== "new" ? <input type="hidden" name="tab" value={tab} /> : null}
              <div className="w-48">
                <Select name="account" defaultValue={account ?? ""} aria-label="Bank account">
                  <option value="">All accounts</option>
                  {inbox.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" size="sm" variant="secondary">
                Filter
              </Button>
            </form>
          ) : null}
        </div>

        <InboxList key={`${tab}-${account ?? ""}-${page}`} rows={inbox.rows} options={options} canEdit={overview.canEdit} tab={tab} />

        {lastPage > 1 ? (
          <div className="flex items-center justify-between pt-4 text-xs text-stone-500">
            <span>
              Page {page} of {lastPage} · {inbox.total} transactions
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link href={href(tab, account, page - 1)} className={buttonStyles({ size: "sm", variant: "secondary" })}>
                  Newer
                </Link>
              ) : null}
              {page < lastPage ? (
                <Link href={href(tab, account, page + 1)} className={buttonStyles({ size: "sm", variant: "secondary" })}>
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
