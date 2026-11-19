import type { Metadata } from "next";
import Link from "next/link";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { ApprovalsPanel } from "@/components/finance/payables/approvals-panel";
import { AttachmentsPanel } from "@/components/finance/payables/attachments-panel";
import { BillActions } from "@/components/finance/payables/bill-actions";
import { RecategorizePanel } from "@/components/finance/payables/recategorize-panel";
import { BillStatusBadge, KindTag } from "@/components/finance/payables/shared";
import { Badge, Card, CardHeader, TBody, TD, TH, THead, TR, Table } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canViewAllFinance, getFinanceAccess } from "@/lib/dal/finance-access";
import { getBill, getBillOptions } from "@/lib/dal/finance-bills";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/finance-bills";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Bill" };
export const dynamic = "force-dynamic";

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/finance/payables/${id}`);
  const { bill, access, options } = await guarded(async () => {
    const [bill, access] = await Promise.all([getBill(ctx, id), getFinanceAccess(ctx)]);
    const options = bill.viewer.canRecategorize ? await getBillOptions(ctx) : null;
    return { bill, access, options };
  });
  const isClaim = bill.kind === "reimbursement";
  const viewAll = canViewAllFinance(access);
  const balance = bill.totalCents - bill.paidCents;
  const livePayments = bill.payments.filter((p) => !p.voidedAt);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/finance/payables" className="text-xs font-semibold text-stone-500 hover:text-charcoal">← Bills &amp; payables</Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl" data-testid="bill-title">
              {isClaim ? "Reimbursement for " : ""}
              {viewAll ? (
                <Link href={`/finance/contacts/${bill.contactId}`} className="hover:underline">
                  {bill.contactName}
                </Link>
              ) : (
                bill.contactName
              )}
            </h1>
            <p className="mt-1 break-words text-sm text-stone-500">{bill.memo}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <BillStatusBadge status={bill.status} />
              <KindTag kind={bill.kind} />
              {bill.programName ? <Badge>{bill.programName}</Badge> : null}
            </div>
          </div>
          <BillActions billId={bill.id} kind={bill.kind} viewer={bill.viewer} approvalsRequired={bill.approvalsRequired} />
        </div>
        {bill.viewer.approveBlockedReason ? (
          <p className="mt-3 rounded-xl bg-alabaster px-3.5 py-2.5 text-sm text-stone-600" data-testid="approve-blocked">
            {bill.viewer.approveBlockedReason}
          </p>
        ) : null}
        {bill.status === "void" ? (
          <p className="mt-3 rounded-xl bg-alabaster px-3.5 py-2.5 text-sm text-stone-600">
            Voided{bill.voidedAt ? ` on ${formatDateTime(bill.voidedAt)}` : ""}. {bill.voidReason}
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Row label={isClaim ? "Member" : "Vendor"}>{bill.contactName}</Row>
              <Row label="Vendor's invoice number">{bill.vendorInvoiceNumber ?? "—"}</Row>
              <Row label={isClaim ? "Date paid by member" : "Bill date"}>{fmtDay(bill.billDate)}</Row>
              <Row label="Due">{bill.dueDate ? fmtDay(bill.dueDate) : "—"}</Row>
              <Row label="Entered by">{bill.createdByName}</Row>
              <Row label="Total">{money(bill.totalCents)}</Row>
              {bill.status === "approved" || bill.status === "partially_paid" || bill.status === "paid" ? (
                <>
                  <Row label="Paid so far">{money(bill.paidCents)}</Row>
                  <Row label="Still owed">{money(balance)}</Row>
                </>
              ) : null}
            </dl>
          </Card>

          <Card>
            <CardHeader title="What was bought" />
            <Table>
              <THead>
                <tr>
                  <TH>Category</TH>
                  <TH>Fund</TH>
                  <TH>Program</TH>
                  <TH className="text-right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {bill.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <span className="font-semibold">{l.accountCode} · {l.accountName}</span>
                      {l.description ? <p className="text-xs text-stone-500">{l.description}</p> : null}
                    </TD>
                    <TD className="text-stone-600">{l.fundName}</TD>
                    <TD className="text-stone-600">{l.programName ?? "Whole organization"}</TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">{money(l.amountCents)}</TD>
                  </TR>
                ))}
                <TR>
                  <TD colSpan={3} className="text-right font-bold">Total</TD>
                  <TD className="whitespace-nowrap text-right font-bold tabular-nums">{money(bill.totalCents)}</TD>
                </TR>
              </TBody>
            </Table>
          </Card>

          {bill.viewer.canRecategorize && options ? (
            <Card>
              <CardHeader title="Review the categories" />
              <RecategorizePanel billId={bill.id} lines={bill.lines} options={options} />
            </Card>
          ) : null}

          <Card>
            <CardHeader title={isClaim ? "Receipts" : "Files"} />
            <AttachmentsPanel billId={bill.id} attachments={bill.attachments} canChange={bill.viewer.canAttach} label={isClaim ? "Receipts" : "Files"} />
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Approvals" />
            <ApprovalsPanel bill={bill} />
          </Card>

          {bill.payments.length > 0 ? (
            <Card>
              <CardHeader title="Payments" />
              <ul className="space-y-2.5 text-sm" data-testid="bill-payments">
                {bill.payments.map((p) => (
                  <li key={p.paymentId} className={p.voidedAt ? "text-stone-400 line-through" : undefined}>
                    <div className="flex items-baseline justify-between gap-3">
                      {viewAll ? (
                        <Link href={`/finance/payables/payments/${p.paymentId}`} className="font-semibold hover:underline">
                          {fmtDay(p.paymentDate)} · {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}
                        </Link>
                      ) : (
                        <span className="font-semibold">{fmtDay(p.paymentDate)}</span>
                      )}
                      <span className="tabular-nums">{money(p.amountCents)}</span>
                    </div>
                    {p.reference ? <p className="text-xs text-stone-500">Ref {p.reference}</p> : null}
                  </li>
                ))}
              </ul>
              {livePayments.length === 0 ? <p className="mt-2 text-xs text-stone-500">All payments on this bill were voided.</p> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-stone-400">{label}</dt>
      <dd className="mt-0.5 break-words text-charcoal">{children}</dd>
    </div>
  );
}
