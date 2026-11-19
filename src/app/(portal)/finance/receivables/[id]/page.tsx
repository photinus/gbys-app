import type { Metadata } from "next";
import Link from "next/link";
import { Pencil, Printer } from "lucide-react";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { AttachmentsPanel } from "@/components/finance/receivables/attachments-panel";
import { InvoiceActions } from "@/components/finance/receivables/invoice-actions";
import { InvoiceStatusBadge } from "@/components/finance/receivables/status-badge";
import { VoidPaymentButton } from "@/components/finance/receivables/void-payment-button";
import { Badge, Card, CardHeader, TBody, TD, TH, THead, TR, Table, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { getInvoice, listInvoiceAttachments } from "@/lib/dal/finance-invoices";
import { formatDateTime } from "@/lib/format";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/finance-invoices";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/receivables/${id}`);
  const { inv, canEdit, files } = await guarded(async () => ({
    inv: await getInvoice(ctx, id),
    canEdit: canEditBooks(await getFinanceAccess(ctx)),
    files: await listInvoiceAttachments(ctx, id),
  }));
  const live = inv.payments.filter((p) => !p.voidedAt);
  const voided = inv.status === "void";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/receivables" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Invoices</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" data-testid="invoice-title">
              Invoice #{inv.number} <InvoiceStatusBadge status={inv.status} overdue={inv.overdue} />
            </h1>
            <p className="mt-1 break-words text-sm text-stone-500">
              For{" "}
              <Link href={`/finance/contacts/${inv.contactId}`} className="font-semibold text-indigo-700 hover:underline">
                {inv.contact.name}
              </Link>
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2">
              {canEdit && inv.status === "draft" ? (
                <Link href={`/finance/receivables/${inv.id}/edit`} className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="edit-invoice">
                  <Pencil className="h-4 w-4" /> Edit draft
                </Link>
              ) : null}
              {inv.status !== "draft" && !voided ? (
                <Link href={`/finance/receivables/${inv.id}/print`} className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="print-invoice">
                  <Printer className="h-4 w-4" /> Print view
                </Link>
              ) : null}
              {canEdit && (inv.status === "open" || inv.status === "partially_paid") ? (
                <Link href={`/finance/receivables/payments/new?invoice=${inv.id}`} className={buttonStyles({ size: "sm" })} data-testid="receive-payment-for">
                  Receive payment
                </Link>
              ) : null}
            </div>
            {canEdit ? (
              <InvoiceActions
                invoiceId={inv.id}
                number={inv.number}
                status={inv.status}
                customerEmail={inv.contact.email}
                alreadySent={!!inv.sentAt}
                hasPayments={live.length > 0}
              />
            ) : null}
          </div>
        </div>
      </div>

      {voided ? (
        <div className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700" data-testid="void-banner">
          <strong>Voided</strong> {inv.voidedAt ? formatDateTime(inv.voidedAt) : ""}. Reason: {inv.voidReason}
        </div>
      ) : null}
      {inv.status === "draft" ? (
        <p className="rounded-2xl bg-alabaster px-4 py-3 text-xs text-stone-600">
          This is a draft. It isn&apos;t in the books and can&apos;t be emailed until you issue it.
        </p>
      ) : null}

      <Card>
        <CardHeader title="Details" />
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold text-stone-400">Invoice date</dt>
            <dd className="text-charcoal">{fmtDay(inv.issueDate)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Due</dt>
            <dd className="text-charcoal">{inv.dueDate ? fmtDay(inv.dueDate) : "On receipt"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Total</dt>
            <dd className="tabular-nums text-charcoal" data-testid="inv-total">{money(inv.totalCents)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Balance due</dt>
            <dd className="font-semibold tabular-nums text-charcoal" data-testid="inv-balance">{money(inv.balanceCents)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Emailed</dt>
            <dd className="text-charcoal" data-testid="inv-sent">
              {inv.sentAt ? (
                <>
                  {formatDateTime(inv.sentAt)}
                  <span className="block break-all text-xs text-stone-500">to {inv.sentToEmail}</span>
                </>
              ) : (
                <span className="text-stone-400">Not sent yet</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Customer email</dt>
            <dd className="break-all text-charcoal">{inv.contact.email ?? <span className="text-stone-400">None on file</span>}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">Created</dt>
            <dd className="text-charcoal">
              {formatDateTime(inv.createdAt)}
              {inv.createdByName ? <span className="block text-xs text-stone-500">by {inv.createdByName}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-400">In the books</dt>
            <dd className="text-charcoal">
              {inv.journalEntryId ? (
                <Link href={`/finance/journal/${inv.journalEntryId}`} className="font-semibold text-indigo-700 hover:underline">
                  Entry #{inv.journalEntryNumber}
                </Link>
              ) : (
                <span className="text-stone-400">Not yet</span>
              )}
            </dd>
          </div>
        </dl>
        {inv.memo ? <p className="mt-4 whitespace-pre-line border-t border-line-soft pt-4 text-sm text-stone-600">{inv.memo}</p> : null}
      </Card>

      <Card>
        <CardHeader title="Lines" />
        <Table className="min-w-0 sm:min-w-[640px]">
          <THead>
            <tr>
              <TH>Description</TH>
              <TH className="hidden sm:table-cell">Category</TH>
              <TH className="hidden sm:table-cell">Fund</TH>
              <TH className="hidden sm:table-cell">Program</TH>
              <TH className="text-right">Amount</TH>
            </tr>
          </THead>
          <TBody>
            {inv.lines.map((l) => (
              <TR key={l.id} data-testid="invoice-line-row">
                <TD className="max-w-[260px]">
                  {l.description}
                  <span className="mt-0.5 block text-xs text-stone-500 sm:hidden">
                    {l.accountCode} {l.accountName} · {l.fundName ?? "General Fund"} · {l.programName ?? "Whole organization"}
                  </span>
                </TD>
                <TD className="hidden text-xs sm:table-cell">
                  <span className="text-stone-400">{l.accountCode}</span> {l.accountName}
                </TD>
                <TD className="hidden text-xs sm:table-cell">{l.fundName ?? "General Fund"}</TD>
                <TD className="hidden text-xs sm:table-cell">{l.programName ?? <span className="text-stone-400">Whole organization</span>}</TD>
                <TD className="text-right tabular-nums">{money(l.amountCents)}</TD>
              </TR>
            ))}
            <TR>
              <TD className="font-semibold">Total</TD>
              <TD className="hidden sm:table-cell" colSpan={3} />
              <TD className="text-right font-semibold tabular-nums">{money(inv.totalCents)}</TD>
            </TR>
            {inv.paidCents > 0 ? (
              <TR>
                <TD>Payments received</TD>
                <TD className="hidden sm:table-cell" colSpan={3} />
                <TD className="text-right tabular-nums">-{money(inv.paidCents)}</TD>
              </TR>
            ) : null}
            <TR>
              <TD className="font-bold">Balance due</TD>
              <TD className="hidden sm:table-cell" colSpan={3} />
              <TD className="text-right font-bold tabular-nums">{money(inv.balanceCents)}</TD>
            </TR>
          </TBody>
        </Table>
      </Card>

      {inv.payments.length > 0 ? (
        <Card>
          <CardHeader title="Payments" description="Voiding a payment puts the amount back on this invoice." />
          <Table className="min-w-0 sm:min-w-[640px]">
            <THead>
              <tr>
                <TH>Date</TH>
                <TH className="hidden sm:table-cell">Method</TH>
                <TH className="hidden sm:table-cell">Deposited to</TH>
                <TH className="text-right">Applied</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {inv.payments.map((p) => (
                <TR key={p.paymentId} className={cn(p.voidedAt && "bg-stone-50/60 text-stone-400")} data-testid="invoice-payment-row">
                  <TD className="whitespace-nowrap">
                    {fmtDay(p.paymentDate)}
                    <span className="block text-xs text-stone-400 sm:hidden">
                      {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}
                      {p.reference ? ` ${p.reference}` : ""} · {p.depositAccountName}
                    </span>
                  </TD>
                  <TD className="hidden text-xs sm:table-cell">
                    {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}
                    {p.reference ? <span className="block text-stone-400">{p.reference}</span> : null}
                  </TD>
                  <TD className="hidden text-xs sm:table-cell">{p.depositAccountName}</TD>
                  <TD className={cn("text-right tabular-nums", p.voidedAt && "line-through")}>{money(p.appliedCents)}</TD>
                  <TD className="text-xs">
                    {p.voidedAt ? (
                      <span>
                        <Badge tone="neutral">Voided</Badge>
                        <span className="mt-1 block max-w-[200px] truncate" title={p.voidReason ?? ""}>{p.voidReason}</span>
                      </span>
                    ) : canEdit ? (
                      <VoidPaymentButton paymentId={p.paymentId} label={`${money(p.appliedCents)} on ${fmtDay(p.paymentDate)}`} />
                    ) : (
                      <Badge tone="success">Received</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Attachments" description="Agreements, purchase orders or anything else that backs up this invoice." />
        <AttachmentsPanel
          invoiceId={inv.id}
          canEdit={canEdit && !voided}
          items={files.map((f) => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes, createdAt: f.createdAt.toISOString() }))}
        />
      </Card>
    </div>
  );
}
