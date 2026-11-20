"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { recordPaymentAction } from "@/app/(portal)/finance/payables/actions";
import { fmtDay, money, parseMoney } from "@/components/finance/gl/format";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, EmptyState, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import type { BankTxnPrefill, OpenBillRow, PaymentOptions } from "@/lib/dal/finance-payments-out";
import { BILL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validation/finance-bills";

/**
 * Pay one bill, or several for the same payee. With `bankTxn` (from the bank inbox) the account and
 * date come from the bank, and the total must equal the bank amount.
 */
export function PayForm({
  openBills,
  options,
  today,
  initialContactId,
  initialBillIds,
  bankTxn,
}: {
  openBills: OpenBillRow[];
  options: PaymentOptions;
  today: string;
  initialContactId?: string;
  initialBillIds?: string[];
  bankTxn?: BankTxnPrefill;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm<{ id: string; entryNumber: number }>(recordPaymentAction);

  const payees = useMemo(() => {
    const m = new Map<string, { id: string; name: string; owed: number }>();
    for (const b of openBills) {
      const cur = m.get(b.contactId) ?? { id: b.contactId, name: b.contactName, owed: 0 };
      cur.owed += b.balanceCents;
      m.set(b.contactId, cur);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [openBills]);

  const firstBill = openBills.find((b) => initialBillIds?.includes(b.id));
  const [contactId, setContactId] = useState(initialContactId ?? firstBill?.contactId ?? "");
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const id of initialBillIds ?? []) {
      const b = openBills.find((x) => x.id === id);
      if (b) init[id] = (b.balanceCents / 100).toFixed(2);
    }
    return init;
  });
  const [method, setMethod] = useState<(typeof BILL_PAYMENT_METHODS)[number]>("check");
  const bills = openBills.filter((b) => b.contactId === contactId);

  const apps = bills.filter((b) => picked[b.id] !== undefined).map((b) => ({ billId: b.id, amountCents: parseMoney(picked[b.id]) ?? 0, balance: b.balanceCents }));
  const total = apps.reduce((s, a) => s + a.amountCents, 0);
  const invalid = apps.some((a) => a.amountCents <= 0 || a.amountCents > a.balance);
  const mismatch = bankTxn ? total !== bankTxn.outCents : false;
  const payload = JSON.stringify(apps.map((a) => ({ billId: a.billId, amountCents: a.amountCents })));

  useEffect(() => {
    if (state?.ok) {
      toast.success(`Payment recorded (entry #${state.data.entryNumber})`);
      router.push(`/finance/payables/payments/${state.data.id}`);
    }
  }, [state, toast, router]);

  const toggle = (b: OpenBillRow) =>
    setPicked((p) => {
      const n = { ...p };
      if (n[b.id] !== undefined) delete n[b.id];
      else n[b.id] = (b.balanceCents / 100).toFixed(2);
      return n;
    });

  if (openBills.length === 0) {
    return <EmptyState title="No bills are ready to pay" description="Bills show up here once they have been approved." />;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 text-sm" data-testid="pay-form">
      <input type="hidden" name="contactId" value={contactId} />
      <input type="hidden" name="applications" value={payload} />
      {bankTxn ? <input type="hidden" name="bankTxnId" value={bankTxn.id} /> : null}

      {bankTxn ? (
        <div className="rounded-2xl bg-periwinkle/20 p-4 text-sm" data-testid="bank-txn-banner">
          <p className="font-semibold">Paying from a bank transaction</p>
          <p className="mt-0.5 text-stone-700">
            {money(bankTxn.outCents)} left the bank on {fmtDay(bankTxn.postedDate)}: {bankTxn.description}. The bills you pick must add up to exactly this amount.
          </p>
        </div>
      ) : null}

      <Field label="Who are you paying?">
        <Select
          value={contactId}
          onChange={(e) => {
            setContactId(e.target.value);
            setPicked({});
          }}
          required
          aria-label="Payee"
        >
          <option value="">Choose a payee…</option>
          {payees.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {money(p.owed)} owed
            </option>
          ))}
        </Select>
      </Field>

      {contactId ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Bills to pay</p>
          <ul className="space-y-2" data-testid="pay-bill-list">
            {bills.map((b) => {
              const on = picked[b.id] !== undefined;
              const bad = on && ((parseMoney(picked[b.id]) ?? 0) <= 0 || (parseMoney(picked[b.id]) ?? 0) > b.balanceCents);
              return (
                <li key={b.id} className="rounded-2xl border border-line p-3.5">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={on} onChange={() => toggle(b)} aria-label={`Pay ${b.memo}`} className="mt-1 h-4 w-4 shrink-0 accent-charcoal" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 break-words font-semibold">
                          {b.vendorInvoiceNumber ? `#${b.vendorInvoiceNumber} · ` : ""}
                          {b.memo}
                        </p>
                        <p className="shrink-0 tabular-nums text-stone-600">{money(b.balanceCents)} owed</p>
                      </div>
                      <p className="text-xs text-stone-500">
                        {b.kind === "reimbursement" ? "Reimbursement · " : ""}
                        {b.dueDate ? `Due ${fmtDay(b.dueDate)}` : `Dated ${fmtDay(b.billDate)}`}
                        {b.paidCents > 0 ? ` · ${money(b.paidCents)} already paid` : ""}
                      </p>
                      {on ? (
                        <div className="mt-2 max-w-[11rem]">
                          <Input
                            inputMode="decimal"
                            value={picked[b.id]}
                            aria-label={`Amount to pay for ${b.memo}`}
                            aria-invalid={bad}
                            onChange={(e) => setPicked((p) => ({ ...p, [b.id]: e.target.value }))}
                            className="text-right tabular-nums"
                          />
                          {bad ? <p className="mt-1 text-xs font-medium text-rose-700">Between $0.01 and {money(b.balanceCents)}.</p> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payment date">
          <Input type="date" name="paymentDate" required defaultValue={bankTxn?.postedDate ?? today} />
        </Field>
        <Field label="How are you paying?">
          <Select name="method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)} aria-label="Payment method">
            {BILL_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={method === "check" ? "Check number" : "Confirmation or reference"} hint="Optional.">
          <Input name="reference" maxLength={100} />
        </Field>
        <Field label="Paid from" hint={bankTxn ? "Set by the bank transaction." : undefined}>
          <Select name="accountId" defaultValue={bankTxn?.glAccountId ?? options.accounts[0]?.id ?? ""} disabled={!!bankTxn} aria-label="Paid from">
            {options.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
          {bankTxn ? <input type="hidden" name="accountId" value={bankTxn.glAccountId} /> : null}
        </Field>
      </div>
      <Field label="Note (optional)">
        <Textarea name="memo" rows={2} maxLength={500} defaultValue={bankTxn ? bankTxn.description : ""} />
      </Field>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-alabaster px-4 py-3">
        <p className="font-bold tabular-nums" data-testid="pay-total">
          Total {money(total)}
        </p>
        {mismatch ? <p className="text-xs font-semibold text-amber-900">Needs to be {money(bankTxn!.outCents)} to match the bank.</p> : null}
      </div>

      <FormError state={state} />
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || apps.length === 0 || invalid || mismatch || !contactId} data-testid="record-payment">
          {pending ? "Recording..." : `Record payment of ${money(total)}`}
        </Button>
      </div>
    </form>
  );
}
