"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { recordPaymentAction } from "@/app/(portal)/finance/receivables/actions";
import { fmtDay, money, parseMoney } from "@/components/finance/gl/format";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Label, Select, Textarea, useToast } from "@/components/ui";
import type { ReceivePaymentFormData } from "@/lib/dal/finance-payments-in";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/validation/finance-invoices";

type Sel = Record<string, { checked: boolean; amount: string }>;

export function PaymentForm({
  data,
  today,
  presetInvoiceId,
}: {
  data: ReceivePaymentFormData;
  today: string;
  presetInvoiceId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(recordPaymentAction);
  const bt = data.bankTxn;

  const presetCustomer = presetInvoiceId ? data.customers.find((c) => c.invoices.some((i) => i.id === presetInvoiceId)) : undefined;
  const guessCustomer =
    !presetCustomer && bt?.payee
      ? data.customers.find((c) => c.contactName.toLowerCase() === bt.payee!.toLowerCase())
      : undefined;
  const [contactId, setContactId] = useState(presetCustomer?.contactId ?? guessCustomer?.contactId ?? "");
  const [sel, setSel] = useState<Sel>(() => {
    if (presetCustomer && presetInvoiceId) {
      const inv = presetCustomer.invoices.find((i) => i.id === presetInvoiceId)!;
      return { [inv.id]: { checked: true, amount: (inv.balanceCents / 100).toFixed(2) } };
    }
    return {};
  });
  const [method, setMethod] = useState<string>("check");
  const bankOptions = data.depositAccounts.filter((a) => !a.isUndeposited);
  const [accountId, setAccountId] = useState<string>(data.undepositedFundsId);

  const customer = data.customers.find((c) => c.contactId === contactId);
  const applications = useMemo(
    () =>
      (customer?.invoices ?? [])
        .filter((i) => sel[i.id]?.checked)
        .map((i) => ({ invoiceId: i.id, amountCents: parseMoney(sel[i.id].amount) ?? 0 })),
    [customer, sel]
  );
  const total = applications.reduce((s, a) => s + a.amountCents, 0);
  const mismatch = bt ? total !== bt.amountCents : false;

  // The page data refreshes right after a successful save (the invoice is no longer "unpaid"), so remember
  // what was submitted instead of reading the current selection.
  const submitted = useRef<string[]>([]);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    submitted.current = applications.map((a) => a.invoiceId);
    onSubmit(e);
  };
  useEffect(() => {
    if (!state?.ok) return;
    toast.success(`Payment recorded (entry #${state.data.entryNumber})`);
    const only = submitted.current.length === 1 ? submitted.current[0] : null;
    router.push(only ? `/finance/receivables/${only}` : "/finance/receivables?tab=payments");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const pickMethod = (m: string) => {
    setMethod(m);
    if (bt) return;
    // Checks and cash usually sit in Undeposited funds until the bank deposit; other methods land in the bank.
    if (m === "check" || m === "cash") setAccountId(data.undepositedFundsId);
    else if (accountId === data.undepositedFundsId && bankOptions[0]) setAccountId(bankOptions[0].id);
  };

  if (data.bankTxnProblem) {
    return <p className="rounded-2xl bg-coral/25 px-4 py-3 text-sm text-rose-900">{data.bankTxnProblem}</p>;
  }
  if (data.customers.length === 0) {
    return <p className="rounded-2xl bg-alabaster px-4 py-3 text-sm text-stone-600">There are no unpaid invoices right now, so there is nothing to apply a payment to.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-5 text-sm" data-testid="payment-form">
      <input type="hidden" name="applications" value={JSON.stringify(applications)} />
      {bt ? <input type="hidden" name="bankTxnId" value={bt.id} /> : null}
      {bt ? <input type="hidden" name="accountId" value={bt.glAccountId} /> : null}

      {bt ? (
        <div className="rounded-2xl bg-periwinkle/20 px-4 py-3 text-sm text-indigo-950" data-testid="bank-prefill">
          Matching bank deposit: <strong>{money(bt.amountCents)}</strong> on {fmtDay(bt.postedDate)} · {bt.description}
          {bt.payee ? ` (${bt.payee})` : ""}. The invoice amounts below must add up to this.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <Label htmlFor="pay-customer">Customer</Label>
          <Select
            id="pay-customer"
            name="contactId"
            required
            value={contactId}
            onChange={(e) => {
              setContactId(e.target.value);
              setSel({});
            }}
          >
            <option value="">Choose a customer…</option>
            {data.customers.map((c) => (
              <option key={c.contactId} value={c.contactId}>
                {c.contactName} ({c.invoices.length} unpaid)
              </option>
            ))}
          </Select>
        </div>
      </div>

      {customer ? (
        <div className="space-y-2">
          <h2 className="text-sm font-bold text-charcoal">Which invoices does this pay?</h2>
          <ul className="space-y-2">
            {customer.invoices.map((i) => {
              const s = sel[i.id];
              const bad = s?.checked && (parseMoney(s.amount) === null || (parseMoney(s.amount) ?? 0) <= 0 || (parseMoney(s.amount) ?? 0) > i.balanceCents);
              return (
                <li key={i.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-3.5 sm:flex-row sm:items-center" data-testid="open-invoice">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-charcoal"
                      checked={!!s?.checked}
                      aria-label={`Apply to invoice ${i.number}`}
                      onChange={(e) =>
                        setSel((prev) => ({ ...prev, [i.id]: { checked: e.target.checked, amount: prev[i.id]?.amount || (i.balanceCents / 100).toFixed(2) } }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold text-charcoal">Invoice #{i.number}</span>
                      <span className="block text-xs text-stone-500">
                        {fmtDay(i.issueDate)}
                        {i.dueDate ? ` · due ${fmtDay(i.dueDate)}` : ""} · {money(i.balanceCents)} left of {money(i.totalCents)}
                      </span>
                    </span>
                  </label>
                  <div className="sm:w-40">
                    <Input
                      inputMode="decimal"
                      aria-label={`Amount for invoice ${i.number}`}
                      placeholder="0.00"
                      disabled={!s?.checked}
                      value={s?.checked ? s.amount : ""}
                      aria-invalid={!!bad}
                      onChange={(e) => setSel((prev) => ({ ...prev, [i.id]: { checked: true, amount: e.target.value } }))}
                      className="text-right tabular-nums"
                    />
                    {bad ? <p className="mt-1 text-xs font-medium text-rose-700">Up to {money(i.balanceCents)}.</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-right text-base font-bold tabular-nums" data-testid="payment-total">
            Payment total {money(total)}
          </p>
          {mismatch && total > 0 ? (
            <p role="alert" className="text-right text-xs font-medium text-rose-700">
              Doesn&apos;t match the {money(bt!.amountCents)} bank deposit.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date received">
          <Input type="date" name="paymentDate" required defaultValue={bt?.postedDate ?? today} />
        </Field>
        <Field label="How was it paid?">
          <Select name="method" value={method} onChange={(e) => pickMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Deposit to"
          hint={bt ? "Set by the bank transaction." : "Checks usually go to Undeposited funds until you deposit them at the bank."}
        >
          <Select
            name={bt ? undefined : "accountId"}
            value={bt ? bt.glAccountId : accountId}
            disabled={!!bt}
            onChange={(e) => setAccountId(e.target.value)}
            data-testid="deposit-account"
          >
            {data.depositAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Check number or reference (optional)">
          <Input name="reference" maxLength={100} placeholder="e.g. 1042" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note (optional)">
            <Textarea name="memo" rows={2} maxLength={500} />
          </Field>
        </div>
      </div>

      <FormError state={state} />
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || total <= 0 || mismatch} data-testid="record-payment">
          {pending ? "Recording..." : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
