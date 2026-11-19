"use client";

import { Plus, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { createCustomerAction, createInvoiceAction, updateInvoiceAction } from "@/app/(portal)/finance/receivables/actions";
import { money, parseMoney } from "@/components/finance/gl/format";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Label, Modal, Select, Textarea, useToast } from "@/components/ui";
import { addDays } from "@/lib/finance/dates";

export interface CustomerOption {
  id: string;
  name: string;
  email: string | null;
}

export interface InvoiceFormOptions {
  customers: CustomerOption[];
  accounts: { id: string; code: string; name: string }[];
  funds: { id: string; name: string; restricted: boolean }[];
  programs: { id: string; name: string }[];
  generalFundId: string;
}

export interface InvoiceFormInitial {
  id: string;
  number: number;
  contactId: string;
  issueDate: string;
  dueDate: string | null;
  memo: string | null;
  lines: { description: string; accountId: string; fundId: string | null; programId: string | null; amountCents: number }[];
}

interface Row {
  key: string;
  description: string;
  accountId: string;
  fundId: string;
  programId: string;
  amount: string;
}

let seq = 0;
function newRow(generalFundId: string, partial: Partial<Row> = {}): Row {
  seq += 1;
  return { key: `r${seq}-${Math.random().toString(36).slice(2, 6)}`, description: "", accountId: "", fundId: generalFundId, programId: "", amount: "", ...partial };
}

export function InvoiceForm({
  options,
  today,
  initial,
  presetContactId,
}: {
  options: InvoiceFormOptions;
  today: string;
  initial?: InvoiceFormInitial;
  presetContactId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const uid = useId();
  const editing = !!initial;
  const { state, pending, onSubmit } = useActionForm(editing ? updateInvoiceAction : createInvoiceAction);
  const [customers, setCustomers] = useState(options.customers);
  const [contactId, setContactId] = useState(initial?.contactId ?? presetContactId ?? "");
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? today);
  const [dueDate, setDueDate] = useState(initial ? (initial.dueDate ?? "") : addDays(today, 30));
  const dueTouched = useRef(!!initial);
  const [rows, setRows] = useState<Row[]>(() =>
    initial
      ? initial.lines.map((l) =>
          newRow(options.generalFundId, {
            description: l.description,
            accountId: l.accountId,
            fundId: l.fundId ?? options.generalFundId,
            programId: l.programId ?? "",
            amount: (l.amountCents / 100).toFixed(2),
          })
        )
      : [newRow(options.generalFundId)]
  );
  const [customerOpen, setCustomerOpen] = useState(false);

  useEffect(() => {
    if (!state?.ok) return;
    const d = state.data as { id: string; number: number; issued: boolean; issueError?: string };
    if (d.issueError) toast.error(`Saved as draft #${d.number}, but it couldn't be issued: ${d.issueError}`);
    else toast.success(d.issued ? `Invoice #${d.number} issued` : `Draft invoice #${d.number} saved`);
    router.push(`/finance/receivables/${d.id}`);
  }, [state, toast, router]);

  const payload = useMemo(
    () =>
      JSON.stringify(
        rows
          .filter((r) => r.description.trim() || r.accountId || r.amount.trim())
          .map((r) => ({
            description: r.description,
            accountId: r.accountId,
            fundId: r.fundId,
            programId: r.programId,
            amountCents: parseMoney(r.amount) ?? 0,
          }))
      ),
    [rows]
  );
  const total = rows.reduce((s, r) => s + (parseMoney(r.amount) ?? 0), 0);
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const intent = e.currentTarget.elements.namedItem("intent") as HTMLInputElement | null;
    if (intent) intent.value = submitter?.value === "issue" ? "issue" : "draft";
    onSubmit(e);
  };

  return (
    <>
      <form onSubmit={submit} className="space-y-5 text-sm" data-testid="invoice-form">
        {initial ? (
          <>
            <input type="hidden" name="id" value={initial.id} />
            <input type="hidden" name="number" value={initial.number} />
          </>
        ) : null}
        <input type="hidden" name="intent" defaultValue="draft" />
        <input type="hidden" name="lines" value={payload} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2">
            <Label htmlFor={`${uid}-customer`}>Customer</Label>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Select id={`${uid}-customer`} name="contactId" required value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">Choose a customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.email ? ` (${c.email})` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="secondary" size="md" onClick={() => setCustomerOpen(true)} data-testid="new-customer-open">
                <UserPlus className="h-4 w-4" /> New
              </Button>
            </div>
          </div>
          <Field label="Invoice date" hint="The day the invoice is dated. Counts as revenue on this day.">
            <Input
              type="date"
              name="issueDate"
              required
              value={issueDate}
              onChange={(e) => {
                setIssueDate(e.target.value);
                if (!dueTouched.current && e.target.value) setDueDate(addDays(e.target.value, 30));
              }}
            />
          </Field>
          <Field label="Due date" hint="Leave blank for due on receipt. Defaults to 30 days.">
            <Input
              type="date"
              name="dueDate"
              value={dueDate}
              onChange={(e) => {
                dueTouched.current = true;
                setDueDate(e.target.value);
              }}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note to customer (optional)" hint="Shown on the invoice and in the email.">
              <Textarea name="memo" rows={2} maxLength={1000} defaultValue={initial?.memo ?? ""} />
            </Field>
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-charcoal">What is this invoice for?</h2>
          <ul className="space-y-3">
            {rows.map((r, i) => {
              const bad = r.amount.trim() !== "" && parseMoney(r.amount) === null;
              return (
                <li key={r.key} data-testid="invoice-line" className="rounded-2xl border border-line bg-white p-3.5 sm:p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-500">Line {i + 1}</span>
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      disabled={rows.length <= 1}
                      aria-label={`Remove line ${i + 1}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-alabaster hover:text-rose-700 disabled:pointer-events-none disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                      <Label htmlFor={`${uid}-d-${r.key}`}>Description</Label>
                      <Input
                        id={`${uid}-d-${r.key}`}
                        value={r.description}
                        maxLength={300}
                        placeholder="e.g. Spring season sponsorship"
                        onChange={(e) => update(r.key, { description: e.target.value })}
                      />
                    </div>
                    <div className="min-w-0 sm:col-span-2 lg:col-span-3">
                      <Label htmlFor={`${uid}-a-${r.key}`}>Category (money in)</Label>
                      <Select id={`${uid}-a-${r.key}`} value={r.accountId} onChange={(e) => update(r.key, { accountId: e.target.value })}>
                        <option value="">Choose a category…</option>
                        {options.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="min-w-0 lg:col-span-2">
                      <Label htmlFor={`${uid}-f-${r.key}`}>Fund</Label>
                      <Select id={`${uid}-f-${r.key}`} value={r.fundId} onChange={(e) => update(r.key, { fundId: e.target.value })}>
                        {options.funds.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                            {f.restricted ? " (restricted)" : ""}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="min-w-0 lg:col-span-2">
                      <Label htmlFor={`${uid}-p-${r.key}`}>Program</Label>
                      <Select id={`${uid}-p-${r.key}`} value={r.programId} onChange={(e) => update(r.key, { programId: e.target.value })}>
                        <option value="">Whole organization</option>
                        {options.programs.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="min-w-0 lg:col-span-2">
                      <Label htmlFor={`${uid}-m-${r.key}`}>Amount ($)</Label>
                      <Input
                        id={`${uid}-m-${r.key}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={r.amount}
                        aria-invalid={bad}
                        onChange={(e) => update(r.key, { amount: e.target.value })}
                        className="text-right tabular-nums"
                      />
                    </div>
                  </div>
                  {bad ? (
                    <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
                      Enter an amount like 250 or 250.00.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, newRow(options.generalFundId)])}>
              <Plus className="h-4 w-4" /> Add a line
            </Button>
            <p className="text-base font-bold tabular-nums" data-testid="invoice-total">
              Total {money(total)}
            </p>
          </div>
        </div>

        {!editing ? <p className="text-xs text-stone-500">You can attach files (a signed agreement, a PO) after saving.</p> : null}
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" value="draft" variant="secondary" disabled={pending} data-testid="save-draft">
            {pending ? "Saving..." : "Save draft"}
          </Button>
          <Button type="submit" value="issue" disabled={pending || total <= 0} data-testid="save-issue">
            Save and issue
          </Button>
        </div>
        <p className="text-right text-xs text-stone-400">Issuing records the money owed in the books. You can still send it by email afterwards.</p>
      </form>

      <NewCustomerModal
        open={customerOpen}
        onClose={() => setCustomerOpen(false)}
        onCreated={(c) => {
          setCustomers((cs) => [...cs, c].sort((a, b) => a.name.localeCompare(b.name)));
          setContactId(c.id);
          setCustomerOpen(false);
        }}
      />
    </>
  );
}

function NewCustomerModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: CustomerOption) => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(createCustomerAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success(`${state.data.name} added`);
      onCreated(state.data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New customer"
      description="Add the person or business you're invoicing."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-customer-form" disabled={pending} data-testid="new-customer-save">
            {pending ? "Adding..." : "Add customer"}
          </Button>
        </>
      }
    >
      <form id="new-customer-form" onSubmit={onSubmit} className="space-y-4 text-sm">
        <Field label="Name">
          <Input name="displayName" required maxLength={200} data-testid="new-customer-name" />
        </Field>
        <Field label="Email" hint="Needed to email invoices. You can add it later.">
          <Input name="email" type="email" maxLength={254} data-testid="new-customer-email" />
        </Field>
        <Field label="Type">
          <Select name="kind" defaultValue="organization">
            <option value="organization">Business or organization</option>
            <option value="individual">Individual</option>
          </Select>
        </Field>
        <FormError state={state} />
      </form>
    </Modal>
  );
}
