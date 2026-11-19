import type { Metadata } from "next";
import Link from "next/link";
import { BulkReceiptSend } from "@/components/finance/donations/bulk-send";
import { ReceiptBadge } from "@/components/finance/donations/receipt-badge";
import { fmtDay } from "@/components/finance/gl/format";
import { guarded } from "@/components/finance/gl/guard";
import { Button, Card, CardHeader, Input, Label, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { previewUnacknowledged } from "@/lib/dal/finance-receipts";
import { isIsoDate, laToday } from "@/lib/finance/dates";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "Send receipts" };
export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function BulkReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSession("/finance/donations/receipts");
  const sp = await searchParams;
  const today = laToday();
  const from = one(sp.from) && isIsoDate(one(sp.from)!) ? one(sp.from)! : `${today.slice(0, 4)}-01-01`;
  const to = one(sp.to) && isIsoDate(one(sp.to)!) ? one(sp.to)! : today;
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const { preview, canEdit } = await guarded(async () => ({ preview: await previewUnacknowledged(ctx, { from: lo, to: hi }), canEdit: canEditBooks(await getFinanceAccess(ctx)) }));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Thank donors who haven't been thanked yet" description="Finds gifts in a date range that have no receipt, then emails them. You see the count first." />
        <form method="get" className="grid grid-cols-1 gap-3 sm:flex sm:items-end">
          <div>
            <Label htmlFor="r-from">Gifts from</Label>
            <Input id="r-from" type="date" name="from" defaultValue={lo} required />
          </div>
          <div>
            <Label htmlFor="r-to">to</Label>
            <Input id="r-to" type="date" name="to" defaultValue={hi} required />
          </div>
          <Button type="submit" variant="secondary">
            Preview
          </Button>
        </form>
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-3" data-testid="bulk-preview">
          <div className="rounded-2xl bg-sage/25 px-4 py-3">
            <p className="text-xs text-stone-600">Ready to email</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="count-emailable">{preview.emailable}</p>
          </div>
          <div className="rounded-2xl bg-amber-soft/30 px-4 py-3">
            <p className="text-xs text-stone-600">No email address (print or mail)</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="count-noemail">{preview.noEmail}</p>
          </div>
          <div className="rounded-2xl bg-alabaster px-4 py-3">
            <p className="text-xs text-stone-600">Money given in these gifts</p>
            <p className="text-2xl font-bold tabular-nums">{formatCents(preview.totalCents)}</p>
          </div>
        </div>
        <div className="mt-5">
          {canEdit ? (
            <BulkReceiptSend from={lo} to={hi} emailable={Math.min(preview.emailable, preview.cap)} />
          ) : (
            <p className="text-sm text-stone-500">Only bookkeepers can send receipts.</p>
          )}
          {preview.emailable > preview.cap ? <p className="mt-2 text-xs text-stone-500">Up to {preview.cap} are sent at a time. Run it again for the rest.</p> : null}
          {preview.noEmail > 0 ? (
            <p className="mt-2 text-xs text-stone-500">
              Donors without an email: open each gift to print the receipt or mark it mailed, or{" "}
              <Link className="font-semibold text-indigo-900 hover:underline" href={`/finance/donations?receipt=needed&from=${lo}&to=${hi}`}>
                see the list
              </Link>
              .
            </p>
          ) : null}
        </div>
      </Card>

      {preview.sample.length ? (
        <Card>
          <CardHeader title="Gifts that need a receipt" description={`Showing the first ${preview.sample.length}.`} />
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Donor</TH>
                <TH className="text-right">Amount</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {preview.sample.map((g) => (
                <TR key={g.id}>
                  <TD className="whitespace-nowrap">
                    <Link href={`/finance/donations/${g.id}`} className="font-semibold text-indigo-900 hover:underline">
                      {fmtDay(g.giftDate)}
                    </Link>
                  </TD>
                  <TD>
                    {g.donorName}
                    {!g.donorEmail ? <span className="block text-xs text-amber-800">no email</span> : null}
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(g.amountCents)}</TD>
                  <TD>
                    <ReceiptBadge status={g.receipt} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
