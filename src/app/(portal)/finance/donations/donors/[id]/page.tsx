import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { ReceiptBadge } from "@/components/finance/donations/receipt-badge";
import { fmtDay } from "@/components/finance/gl/format";
import { guarded } from "@/components/finance/gl/guard";
import { Badge, Card, CardHeader, Table, TBody, TD, TH, THead, TR, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { getDonor } from "@/lib/dal/finance-donations";
import { formatCents, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Donor" };
export const dynamic = "force-dynamic";

export default async function DonorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/donations/donors/${id}`);
  const { d, canEdit } = await guarded(async () => ({ d: await getDonor(ctx, id), canEdit: canEditBooks(await getFinanceAccess(ctx)) }));
  const c = d.contact;
  const addr = [c.addressLine1, c.addressLine2, [c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean);
  return (
    <div className="space-y-5">
      <Link href="/finance/donations/donors" className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-charcoal">
        <ArrowLeft className="h-4 w-4" /> All donors
      </Link>
      <Card>
        <CardHeader
          title={<span data-testid="donor-name">{c.displayName}</span>}
          description={c.kind === "organization" ? "Business or organization" : "Individual"}
          action={
            <>
              {canEdit ? (
                <Link href={`/finance/donations/new?donor=${c.id}`} className={buttonStyles({ size: "sm" })}>
                  <Plus className="h-4 w-4" /> Record a gift
                </Link>
              ) : null}
              {canEdit ? (
                <Link href={`/finance/contacts/${c.id}`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
                  Edit contact details
                </Link>
              ) : null}
            </>
          }
        />
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-stone-500">Email</dt>
            <dd className="font-medium">{c.email ?? <span className="text-amber-800">None on file (needed to email receipts)</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">Phone</dt>
            <dd className="font-medium">{c.phone ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-stone-500">Mailing address</dt>
            <dd className="font-medium">{addr.length ? addr.map((l, i) => <span key={i} className="block">{l}</span>) : <span className="text-amber-800">None on file (needed to print receipts)</span>}</dd>
          </div>
        </dl>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-alabaster px-4 py-3">
            <p className="text-xs text-stone-500">Lifetime giving</p>
            <p className="text-xl font-bold tabular-nums" data-testid="lifetime">{formatCents(d.lifetimeCents)}</p>
          </div>
          <div className="rounded-2xl bg-alabaster px-4 py-3">
            <p className="text-xs text-stone-500">In-kind gifts (value)</p>
            <p className="text-xl font-bold tabular-nums">{formatCents(d.inKindLifetimeCents)}</p>
          </div>
          <div className="rounded-2xl bg-alabaster px-4 py-3">
            <p className="text-xs text-stone-500">Gifts needing a receipt</p>
            <p className="text-xl font-bold tabular-nums">{d.needsReceiptCount}</p>
          </div>
        </div>
      </Card>

      {d.byYear.length ? (
        <Card>
          <CardHeader title="By year" description="Yearly statements list every gift from a calendar year in one letter." />
          <Table>
            <THead>
              <tr>
                <TH>Year</TH>
                <TH className="text-right">Money given</TH>
                <TH className="text-right">In-kind (value)</TH>
                <TH className="text-right">Gifts</TH>
                <TH />
              </tr>
            </THead>
            <TBody>
              {d.byYear.map((y) => (
                <TR key={y.year}>
                  <TD className="font-semibold">{y.year}</TD>
                  <TD className="text-right tabular-nums">{formatCents(y.moneyCents)}</TD>
                  <TD className="text-right tabular-nums">{formatCents(y.inKindCents)}</TD>
                  <TD className="text-right tabular-nums">{y.giftCount}</TD>
                  <TD className="text-right">
                    <Link className="text-xs font-semibold text-indigo-900 hover:underline" href={`/finance/donations/statements/print?year=${y.year}&donor=${c.id}`}>
                      View statement
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Giving history" />
        {d.gifts.length === 0 ? (
          <p className="text-sm text-stone-500">No gifts yet.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Gift</TH>
                <TH className="text-right">Amount</TH>
                <TH>Fund</TH>
                <TH>Receipt</TH>
              </tr>
            </THead>
            <TBody>
              {d.gifts.map((g) => (
                <TR key={g.id} className={g.voided ? "opacity-50" : undefined}>
                  <TD className="whitespace-nowrap">
                    <Link href={`/finance/donations/${g.id}`} className="font-semibold text-indigo-900 hover:underline">
                      {fmtDay(g.giftDate)}
                    </Link>
                  </TD>
                  <TD>
                    {g.kindLabel}
                    {g.kind === "check" && g.reference ? ` #${g.reference}` : ""}
                    {g.voided ? <Badge tone="danger" className="ml-2">Voided</Badge> : null}
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{formatCents(g.amountCents)}</TD>
                  <TD>{g.fundName}</TD>
                  <TD>
                    <ReceiptBadge status={g.receipt} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Receipts sent" />
        {d.receipts.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing sent yet.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>What</TH>
                <TH>How</TH>
                <TH className="text-right">Amount stated</TH>
                <TH>By</TH>
              </tr>
            </THead>
            <TBody>
              {d.receipts.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(r.sentAt)}</TD>
                  <TD>
                    {r.kind === "annual" ? `${r.taxYear} yearly statement` : r.giftId ? <Link className="hover:underline" href={`/finance/donations/${r.giftId}`}>Gift of {r.giftDate ? fmtDay(r.giftDate) : ""}</Link> : "Gift"}
                  </TD>
                  <TD>
                    <Badge tone="neutral">{r.method === "email" ? `Emailed${r.sentTo ? ` to ${r.sentTo}` : ""}` : r.method === "mail" ? "Mailed" : "Printed"}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums">{formatCents(r.amountCents)}</TD>
                  <TD>{r.sentByName ?? ""}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
