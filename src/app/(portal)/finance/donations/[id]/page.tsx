import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { AttachmentsPanel, GiftReceiptActions, VoidGiftButton } from "@/components/finance/donations/gift-actions";
import { ReceiptBadge } from "@/components/finance/donations/receipt-badge";
import { fmtDay } from "@/components/finance/gl/format";
import { guarded } from "@/components/finance/gl/guard";
import { Badge, Card, CardHeader, Table, TBody, TD, TH, THead, TR, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { getGift } from "@/lib/dal/finance-donations";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Gift" };
export const dynamic = "force-dynamic";

export default async function GiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/donations/${id}`);
  const { g, canEdit } = await guarded(async () => ({ g: await getGift(ctx, id), canEdit: canEditBooks(await getFinanceAccess(ctx)) }));
  const lastGiftReceipt = g.receipts.find((r) => r.kind === "gift");
  const latestSentAt = g.receipts[0]?.sentAt ?? null;
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
        <dt className="text-stone-500 sm:w-48 sm:shrink-0">{label}</dt>
        <dd className="min-w-0 break-words font-medium">{value}</dd>
      </div>
    ) : null;

  return (
    <div className="space-y-5">
      <Link href="/finance/donations" className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-charcoal">
        <ArrowLeft className="h-4 w-4" /> All gifts
      </Link>

      {g.voided ? (
        <p className="rounded-xl bg-coral/25 px-4 py-3 text-sm text-rose-950" data-testid="voided-banner">
          <strong>This gift was voided</strong> on {formatDate(g.voidedAt!)}
          {g.voidedByName ? ` by ${g.voidedByName}` : ""}. Reason: {g.voidReason}
        </p>
      ) : null}

      <Card>
        <CardHeader
          title={
            <span data-testid="gift-title">
              {formatCents(g.amountCents)}
              {g.kind === "in_kind" ? " in-kind gift" : " gift"} from {g.donorName ?? "an anonymous donor"}
            </span>
          }
          description={`${g.kindLabel} · ${fmtDay(g.giftDate)}`}
          action={
            canEdit && !g.voided ? (
              <>
                <Link href={`/finance/donations/${g.id}/edit`} className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="edit-gift">
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
                <VoidGiftButton giftId={g.id} receiptSentAt={latestSentAt ? latestSentAt.toISOString() : null} />
              </>
            ) : undefined
          }
        />
        <dl className="divide-y divide-line-soft text-sm">
          {row("Donor", g.donorId ? <Link href={`/finance/donations/donors/${g.donorId}`} className="text-indigo-900 hover:underline">{g.donorName}</Link> : "Anonymous (no donor on record)")}
          {row("Hidden in public lists", g.isAnonymous && g.donorId ? "Yes, donor asked to stay anonymous" : null)}
          {g.kind === "in_kind" ? (
            <>
              {row("What was donated", g.inKindDescription)}
              {row("Fair value (books only)", formatCents(g.amountCents))}
              {row("Recorded as", g.inKindDebitAccount ? `${g.inKindDebitAccount.code} · ${g.inKindDebitAccount.name}` : null)}
            </>
          ) : (
            <>
              {row("Category", `${g.revenueAccount.code} · ${g.revenueAccount.name}`)}
              {row("Deposited to", g.depositAccount ? `${g.depositAccount.code} · ${g.depositAccount.name}` : null)}
              {row("Reference", g.reference ? (g.kind === "check" ? `Check #${g.reference}` : g.reference) : null)}
            </>
          )}
          {row("Fund", g.fundName)}
          {row("Program", g.programName)}
          {row("Campaign", g.campaign)}
          {g.goodsServicesCents > 0
            ? row("Given in return", `${g.goodsServicesDescription ?? "Goods or services"} (worth ${formatCents(g.goodsServicesCents)}); deductible ${g.kind === "in_kind" ? "n/a" : formatCents(g.amountCents - g.goodsServicesCents)}`)
            : null}
          {row("Note", g.note)}
          {row("Books", g.journalEntryId ? <Link href={`/finance/journal/${g.journalEntryId}`} className="text-indigo-900 hover:underline">Journal entry #{g.journalEntryNumber}</Link> : null)}
          {row("From bank transaction", g.bankTxn ? `${g.bankTxn.description} (${fmtDay(g.bankTxn.postedDate)})` : null)}
          {row("Recorded", `${formatDateTime(g.createdAt)}${g.createdByName ? ` by ${g.createdByName}` : ""}`)}
        </dl>
      </Card>

      <Card>
        <CardHeader title="Thank-you receipt" description="Written acknowledgment for the donor's tax records (IRS Pub. 1771)." action={<ReceiptBadge status={g.receipt} />} />
        {g.voided ? (
          <p className="text-sm text-stone-500">Voided gifts don&apos;t get receipts.</p>
        ) : !g.donorId ? (
          <p className="text-sm text-stone-500" data-testid="no-receipt-anon">This gift has no donor on record, so it can&apos;t be receipted. Edit the gift to add a donor.</p>
        ) : canEdit ? (
          <GiftReceiptActions
            giftId={g.id}
            hasEmail={!!g.donorEmail}
            donorName={g.donorName ?? "The donor"}
            needsReceipt={g.receipt.needsReceipt}
            alreadySent={g.receipt.kind !== "not_sent"}
          />
        ) : (
          <p className="text-sm text-stone-500">Only bookkeepers can send receipts.</p>
        )}
        {g.receipt.outdated ? (
          <p className="mt-3 rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950" data-testid="receipt-outdated">
            This gift changed after its last receipt ({lastGiftReceipt ? formatDate(lastGiftReceipt.sentAt) : ""}). Send a corrected receipt.
          </p>
        ) : null}
        {g.receipts.length ? (
          <div className="mt-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Receipt history</h3>
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
                {g.receipts.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap">{formatDateTime(r.sentAt)}</TD>
                    <TD>{r.kind === "annual" ? `${r.taxYear} yearly statement` : "Gift receipt"}</TD>
                    <TD>
                      <Badge tone="neutral">{r.method === "email" ? `Emailed${r.sentTo ? ` to ${r.sentTo}` : ""}` : r.method === "mail" ? "Mailed" : "Printed"}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{formatCents(r.amountCents)}</TD>
                    <TD>{r.sentByName ?? ""}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Files" description="Check images, letters or other paperwork." />
        <AttachmentsPanel giftId={g.id} items={g.attachments} canEdit={canEdit && !g.voided} />
      </Card>
    </div>
  );
}
