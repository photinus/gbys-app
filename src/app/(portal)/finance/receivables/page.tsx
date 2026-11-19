import type { Metadata } from "next";
import Link from "next/link";
import { CircleDollarSign, Clock, FileText, Plus } from "lucide-react";
import { guarded } from "@/components/finance/gl/guard";
import { fmtDay, money } from "@/components/finance/gl/format";
import { InvoiceStatusBadge } from "@/components/finance/receivables/status-badge";
import { VoidPaymentButton } from "@/components/finance/receivables/void-payment-button";
import { Badge, Button, Card, EmptyState, KpiCard, Select, TBody, TD, TH, THead, TR, Table, buttonStyles } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { canEditBooks, getFinanceAccess } from "@/lib/dal/finance-access";
import { listContacts } from "@/lib/dal/finance-contacts";
import { getInvoiceSummary, listInvoices } from "@/lib/dal/finance-invoices";
import { listPaymentsIn } from "@/lib/dal/finance-payments-in";
import { PAYMENT_METHOD_LABELS, INVOICE_STATUS_LABELS } from "@/lib/validation/finance-invoices";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

type SP = { tab?: string; status?: string; overdue?: string; customer?: string };

const tab = (active: boolean) => buttonStyles({ variant: active ? "primary" : "secondary", size: "sm" });

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireSession("/finance/receivables");
  const sp = await searchParams;
  const payments = sp.tab === "payments";
  const filter = {
    status: sp.status && (sp.status === "unpaid" || sp.status in INVOICE_STATUS_LABELS) ? sp.status : undefined,
    overdue: sp.overdue === "1",
    contactId: sp.customer || undefined,
  };
  const data = await guarded(async () => {
    const canEdit = canEditBooks(await getFinanceAccess(ctx));
    const customers = await listContacts(ctx, { role: "customer", includeInactive: true, limit: 1000 });
    const summary = await getInvoiceSummary(ctx);
    return payments
      ? { canEdit, customers, summary, invoices: [], pays: await listPaymentsIn(ctx, { contactId: filter.contactId }) }
      : { canEdit, customers, summary, invoices: await listInvoices(ctx, filter), pays: [] };
  });
  const hasFilter = !!(filter.status || filter.overdue || filter.contactId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Invoices</h1>
          <p className="mt-1 text-sm text-stone-500">Bill sponsors and customers, email them, and record the payments you receive.</p>
        </div>
        {data.canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/finance/receivables/payments/new" className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="receive-payment">
              <CircleDollarSign className="h-4 w-4" /> Receive payment
            </Link>
            <Link href="/finance/receivables/new" className={buttonStyles({ size: "sm" })} data-testid="new-invoice">
              <Plus className="h-4 w-4" /> New invoice
            </Link>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard icon={FileText} label="Owed to us" value={money(data.summary.outstandingCents)} hint={`${data.summary.openCount} unpaid invoice${data.summary.openCount === 1 ? "" : "s"}`} />
        <KpiCard
          icon={Clock}
          tone="coral"
          label="Overdue"
          value={money(data.summary.overdueCents)}
          hint={`${data.summary.overdueCount} overdue invoice${data.summary.overdueCount === 1 ? "" : "s"}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/finance/receivables" className={tab(!payments)}>
          Invoices
        </Link>
        <Link href="/finance/receivables?tab=payments" className={tab(payments)} data-testid="payments-tab">
          Payments received
        </Link>
        <Link href="/finance/reports/ar-aging" className={cn(buttonStyles({ variant: "ghost", size: "sm" }), "ml-auto")}>
          Aging report →
        </Link>
      </div>

      <Card>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="invoice-filters">
          {payments ? <input type="hidden" name="tab" value="payments" /> : null}
          {!payments ? (
            <div className="min-w-0">
              <label htmlFor="rf-status" className="mb-1 block text-xs font-semibold text-stone-600">Status</label>
              <Select id="rf-status" name="status" defaultValue={filter.status ?? ""}>
                <option value="">All</option>
                <option value="unpaid">Unpaid (open + partly paid)</option>
                {Object.entries(INVOICE_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="min-w-0">
            <label htmlFor="rf-customer" className="mb-1 block text-xs font-semibold text-stone-600">Customer</label>
            <Select id="rf-customer" name="customer" defaultValue={filter.contactId ?? ""}>
              <option value="">All customers</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </Select>
          </div>
          {!payments ? (
            <label className="flex items-end gap-2 pb-2 text-sm text-charcoal">
              <input type="checkbox" name="overdue" value="1" defaultChecked={filter.overdue} className="h-4 w-4 accent-charcoal" />
              Overdue only
            </label>
          ) : null}
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm">Filter</Button>
            {hasFilter ? (
              <Link href={payments ? "/finance/receivables?tab=payments" : "/finance/receivables"} className={buttonStyles({ variant: "ghost", size: "sm" })}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      <Card>
        {payments ? (
          data.pays.length === 0 ? (
            <EmptyState title="No payments yet" description="Payments you record against invoices show up here." />
          ) : (
            <Table className="min-w-0 sm:min-w-[720px]">
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Customer</TH>
                  <TH className="hidden sm:table-cell">Invoices</TH>
                  <TH className="hidden sm:table-cell">Method</TH>
                  <TH className="hidden md:table-cell">Deposited to</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {data.pays.map((p) => (
                  <TR key={p.id} className={cn(p.voidedAt && "bg-stone-50/60 text-stone-400")} data-testid="payment-row">
                    <TD className="whitespace-nowrap">{fmtDay(p.paymentDate)}</TD>
                    <TD className="max-w-[180px]">
                      <span className="block truncate">{p.contactName}</span>
                      <span className="block text-xs text-stone-400 sm:hidden">{p.invoiceNumbers.map((n) => `#${n}`).join(", ")}</span>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-xs sm:table-cell">{p.invoiceNumbers.map((n) => `#${n}`).join(", ")}</TD>
                    <TD className="hidden text-xs sm:table-cell">
                      {PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS] ?? p.method}
                      {p.reference ? <span className="block text-stone-400">{p.reference}</span> : null}
                    </TD>
                    <TD className="hidden text-xs md:table-cell">{p.depositAccountName}</TD>
                    <TD className={cn("text-right tabular-nums", p.voidedAt && "line-through")}>{money(p.amountCents)}</TD>
                    <TD className="text-xs">
                      {p.voidedAt ? (
                        <span>
                          <Badge tone="neutral">Voided</Badge>
                          <span className="mt-1 block max-w-[200px] truncate" title={p.voidReason ?? ""}>{p.voidReason}</span>
                        </span>
                      ) : data.canEdit ? (
                        <VoidPaymentButton paymentId={p.id} label={`${money(p.amountCents)} from ${p.contactName}`} />
                      ) : (
                        <Badge tone="success">Recorded</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )
        ) : data.invoices.length === 0 ? (
          <EmptyState
            title={hasFilter ? "No invoices match those filters" : "No invoices yet"}
            description={hasFilter ? "Try clearing the filters." : "Create an invoice for a sponsor or customer to get started."}
            action={
              data.canEdit && !hasFilter ? (
                <Link href="/finance/receivables/new" className={buttonStyles({ size: "sm" })}>
                  New invoice
                </Link>
              ) : undefined
            }
          />
        ) : (
          <Table className="min-w-0 sm:min-w-[640px]">
            <THead>
              <tr>
                <TH className="w-16">#</TH>
                <TH>Customer</TH>
                <TH className="hidden sm:table-cell">Date</TH>
                <TH className="hidden sm:table-cell">Due</TH>
                <TH className="hidden text-right sm:table-cell">Total</TH>
                <TH className="text-right">Balance</TH>
                <TH className="hidden sm:table-cell">Status</TH>
              </tr>
            </THead>
            <TBody>
              {data.invoices.map((i) => (
                <TR key={i.id} className={cn(i.status === "void" && "bg-stone-50/60 text-stone-400")} data-testid="invoice-row">
                  <TD className="tabular-nums">
                    <Link href={`/finance/receivables/${i.id}`} className="font-semibold text-indigo-700 hover:underline">
                      {i.number}
                    </Link>
                  </TD>
                  <TD className="max-w-[200px]">
                    <Link href={`/finance/receivables/${i.id}`} className="block truncate hover:underline">
                      {i.contactName}
                    </Link>
                    <span className="block text-xs text-stone-400 sm:hidden">
                      {i.dueDate ? `Due ${fmtDay(i.dueDate)}` : "Due on receipt"} · {money(i.totalCents)}
                    </span>
                    <span className="mt-1 block sm:hidden">
                      <InvoiceStatusBadge status={i.status} overdue={i.overdue} />
                    </span>
                  </TD>
                  <TD className="hidden whitespace-nowrap sm:table-cell">{fmtDay(i.issueDate)}</TD>
                  <TD className="hidden whitespace-nowrap sm:table-cell">{i.dueDate ? fmtDay(i.dueDate) : <span className="text-stone-400">On receipt</span>}</TD>
                  <TD className={cn("hidden text-right tabular-nums sm:table-cell", i.status === "void" && "line-through")}>{money(i.totalCents)}</TD>
                  <TD className="text-right tabular-nums">{i.status === "void" || i.status === "draft" ? "" : money(i.balanceCents)}</TD>
                  <TD className="hidden sm:table-cell">
                    <InvoiceStatusBadge status={i.status} overdue={i.overdue} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
