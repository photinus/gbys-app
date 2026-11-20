import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ReceiptBadge } from "@/components/finance/donations/receipt-badge";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay } from "@/components/finance/gl/format";
import { Badge, Button, Card, EmptyState, Input, Label, Select, Table, TBody, TD, TH, THead, TR, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { getDonor, listFundChoices, listGifts } from "@/lib/dal/finance-donations";
import { formatCents } from "@/lib/format";
import { isIsoDate } from "@/lib/finance/dates";
import { RECEIPT_FILTERS, type ReceiptFilter } from "@/lib/validation/finance-donations";

export const metadata: Metadata = { title: "Donations" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) || undefined;
};

export default async function GiftsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireSession("/finance/donations");
  const sp = await searchParams;
  const from = one(sp, "from");
  const to = one(sp, "to");
  const receipt = RECEIPT_FILTERS.includes(one(sp, "receipt") as ReceiptFilter) ? (one(sp, "receipt") as ReceiptFilter) : "all";
  const filters = {
    from: from && isIsoDate(from) ? from : undefined,
    to: to && isIsoDate(to) ? to : undefined,
    fundId: one(sp, "fund"),
    campaign: one(sp, "campaign"),
    donorId: one(sp, "donor"),
    receipt,
    includeVoided: one(sp, "voided") === "1",
    page: Number(one(sp, "page")) || 1,
  };
  const { list, allFunds, canEdit, donorName } = await guarded(async () => ({
    list: await listGifts(ctx, filters),
    allFunds: await listFundChoices(ctx),
    canEdit: canEditBooks(await getFinanceAccess(ctx)),
    donorName: filters.donorId ? await getDonor(ctx, filters.donorId).then((d) => d.contact.displayName).catch(() => null) : null,
  }));

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | undefined> = { from: filters.from, to: filters.to, fund: filters.fundId, campaign: filters.campaign, donor: filters.donorId, receipt: receipt === "all" ? undefined : receipt, voided: filters.includeVoided ? "1" : undefined, ...over };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/finance/donations?${s}` : "/finance/donations";
  };
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));

  return (
    <div className="space-y-5">
      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" data-testid="gift-filters">
          <div>
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" name="from" defaultValue={filters.from} />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" name="to" defaultValue={filters.to} />
          </div>
          <div>
            <Label htmlFor="f-fund">Fund</Label>
            <Select id="f-fund" name="fund" defaultValue={filters.fundId ?? ""}>
              <option value="">All funds</option>
              {allFunds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="f-campaign">Campaign</Label>
            <Input id="f-campaign" name="campaign" defaultValue={filters.campaign} placeholder="Any" />
          </div>
          <div>
            <Label htmlFor="f-receipt">Receipt</Label>
            <Select id="f-receipt" name="receipt" defaultValue={receipt}>
              <option value="all">Any status</option>
              <option value="needed">Needs a receipt</option>
              <option value="required">Receipt required ($250+)</option>
              <option value="not_sent">Not sent</option>
              <option value="sent">Sent</option>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit">Filter</Button>
            <Link href="/finance/donations" className="text-xs font-semibold text-stone-500 hover:text-charcoal">
              Clear
            </Link>
          </div>
          {filters.donorId ? <input type="hidden" name="donor" value={filters.donorId} /> : null}
          <label className="flex items-center gap-2 text-xs text-stone-600 sm:col-span-2 lg:col-span-6">
            <input type="checkbox" name="voided" value="1" defaultChecked={filters.includeVoided} /> Include voided gifts
          </label>
        </form>
      </Card>

      {donorName ? (
        <p className="text-sm text-stone-600">
          Showing gifts from <strong>{donorName}</strong>.{" "}
          <Link href={qs({ donor: undefined })} className="font-semibold text-indigo-900 hover:underline">
            Show everyone
          </Link>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600" data-testid="gift-totals">
          <strong>{list.total}</strong> gift{list.total === 1 ? "" : "s"} · {formatCents(list.totals.moneyCents)} given
          {list.totals.inKindCents ? ` · ${formatCents(list.totals.inKindCents)} in-kind` : ""}
        </p>
        {canEdit ? (
          <Link href="/finance/donations/new" className={buttonStyles({ size: "md" })} data-testid="record-gift">
            <Plus className="h-4 w-4" /> Record a gift
          </Link>
        ) : null}
      </div>

      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            title="No gifts found"
            description={canEdit ? "Record your first gift, or loosen the filters." : "Loosen the filters to see more."}
            action={canEdit ? <Link href="/finance/donations/new" className={buttonStyles({ size: "sm" })}>Record a gift</Link> : undefined}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Donor</TH>
                <TH className="text-right">Amount</TH>
                <TH>Fund</TH>
                <TH>Receipt</TH>
              </tr>
            </THead>
            <TBody>
              {list.rows.map((g) => (
                <TR key={g.id} className={g.voided ? "opacity-50" : undefined} data-testid="gift-row">
                  <TD className="whitespace-nowrap">
                    <Link href={`/finance/donations/${g.id}`} className="font-semibold text-indigo-900 hover:underline">
                      {fmtDay(g.giftDate)}
                    </Link>
                  </TD>
                  <TD>
                    {g.donorId ? (
                      <Link href={`/finance/donations/donors/${g.donorId}`} className="font-semibold hover:underline">
                        {g.donorName}
                      </Link>
                    ) : (
                      <span className="text-stone-500">Anonymous</span>
                    )}
                    {g.isAnonymous && g.donorId ? <Badge tone="neutral" className="ml-2">Hide name</Badge> : null}
                    {g.voided ? <Badge tone="danger" className="ml-2">Voided</Badge> : null}
                    <span className="block text-xs text-stone-500">
                      {g.kindLabel}
                      {g.kind === "check" && g.reference ? ` #${g.reference}` : ""}
                      {g.kind === "in_kind" && g.inKindDescription ? `: ${g.inKindDescription.slice(0, 40)}${g.inKindDescription.length > 40 ? "…" : ""}` : ""}
                      {g.campaign ? ` · ${g.campaign}` : ""}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums font-semibold">
                    {formatCents(g.amountCents)}
                    {g.kind === "in_kind" ? <span className="block text-xs font-normal text-stone-500">value</span> : null}
                  </TD>
                  <TD>
                    {g.fundName}
                    {g.programName ? <span className="block text-xs text-stone-500">{g.programName}</span> : null}
                  </TD>
                  <TD>
                    <ReceiptBadge status={g.receipt} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-xs text-stone-500">
            <span>
              Page {list.page} of {pages}
            </span>
            <span className="flex gap-3">
              {list.page > 1 ? <Link className="font-semibold hover:underline" href={qs({ page: String(list.page - 1) })}>Previous</Link> : null}
              {list.page < pages ? <Link className="font-semibold hover:underline" href={qs({ page: String(list.page + 1) })}>Next</Link> : null}
            </span>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
