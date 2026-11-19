"use client";

import { Paperclip, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createBillAction, updateBillAction, type SaveBillResult } from "@/app/(portal)/finance/payables/actions";
import { money, parseMoney } from "@/components/finance/gl/format";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Label, Select, Textarea, useToast } from "@/components/ui";
import type { BillOptions } from "@/lib/dal/finance-bills";
import { defaultDueDate } from "@/lib/finance/payables-math";

interface FormLine {
  key: string;
  accountId: string;
  fundId: string;
  programId: string;
  amount: string;
  description: string;
}

export interface BillFormInitial {
  id: string;
  contactId: string;
  vendorInvoiceNumber: string | null;
  programId: string | null;
  billDate: string;
  dueDate: string | null;
  memo: string;
  lines: { accountId: string; fundId: string | null; programId: string | null; amountCents: number; description: string | null }[];
}

let seq = 0;
function blankLine(o: BillOptions, programId: string, accountId = ""): FormLine {
  seq += 1;
  return { key: `l${seq}`, accountId, fundId: o.generalFundId, programId, amount: "", description: "" };
}

const NEW_VENDOR = "__new__";

/**
 * Create or edit a draft bill. "Save draft" keeps it private to the creator and bookkeepers;
 * "Save and submit" sends it for approval. Program editors can only pick their own program(s).
 */
export function BillForm({
  options,
  today,
  initial,
  defaultContactId,
}: {
  options: BillOptions;
  today: string;
  initial?: BillFormInitial;
  defaultContactId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const uid = useId();
  const editing = !!initial;
  const { state, pending, onSubmit } = useActionForm<SaveBillResult>(editing ? updateBillAction : createBillAction);

  const onlyProgram = !options.orgWide && options.programs.length === 1 ? options.programs[0].id : "";
  const [contactId, setContactId] = useState(initial?.contactId ?? defaultContactId ?? "");
  const [newVendor, setNewVendor] = useState({ displayName: "", email: "", phone: "", kind: "organization" });
  const [billDate, setBillDate] = useState(initial?.billDate ?? today);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? defaultDueDate(initial?.billDate ?? today));
  const [dueTouched, setDueTouched] = useState(!!initial?.dueDate);
  const [programId, setProgramId] = useState(initial?.programId ?? onlyProgram);
  const [lines, setLines] = useState<FormLine[]>(() =>
    initial
      ? initial.lines.map((l) => {
          seq += 1;
          return {
            key: `l${seq}`,
            accountId: l.accountId,
            fundId: l.fundId ?? options.generalFundId,
            programId: l.programId ?? "",
            amount: (l.amountCents / 100).toFixed(2),
            description: l.description ?? "",
          };
        })
      : [blankLine(options, onlyProgram, options.vendors.find((v) => v.id === (defaultContactId ?? ""))?.defaultAccountId ?? "")]
  );

  const intentRef = useRef<HTMLInputElement>(null);
  const isNew = contactId === NEW_VENDOR;
  const total = useMemo(() => lines.reduce((s, l) => s + (parseMoney(l.amount) ?? 0), 0), [lines]);
  const linesPayload = useMemo(
    () =>
      JSON.stringify(
        lines.map((l) => ({
          accountId: l.accountId,
          fundId: l.fundId === options.generalFundId ? "" : l.fundId,
          programId: l.programId,
          amountCents: parseMoney(l.amount) ?? 0,
          description: l.description,
        }))
      ),
    [lines, options.generalFundId]
  );

  useEffect(() => {
    if (!state?.ok) return;
    const d = state.data;
    if (d.submitError) toast.error(`Saved as a draft, but it wasn't submitted: ${d.submitError}`);
    else toast.success(d.submitted ? "Submitted for approval" : "Draft saved");
    router.push(`/finance/payables/${d.id}`);
  }, [state, toast, router]);

  const update = (key: string, patch: Partial<FormLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const chooseVendor = (id: string) => {
    setContactId(id);
    const v = options.vendors.find((x) => x.id === id);
    if (v?.defaultAccountId) setLines((ls) => ls.map((l, i) => (i === 0 && !l.accountId ? { ...l, accountId: v.defaultAccountId! } : l)));
  };

  const changeProgram = (next: string) => {
    setLines((ls) => ls.map((l) => (l.programId === programId ? { ...l, programId: next } : l)));
    setProgramId(next);
  };

  const accountGroups = [
    { label: "Expenses", accounts: options.accounts.filter((a) => a.type === "expense") },
    { label: "Equipment, prepaid & other assets", accounts: options.accounts.filter((a) => a.type === "asset") },
  ].filter((g) => g.accounts.length > 0);

  return (
    <form onSubmit={onSubmit} className="space-y-6 text-sm" data-testid="bill-form">
      {initial ? <input type="hidden" name="billId" value={initial.id} /> : null}
      <input type="hidden" name="contactId" value={isNew ? "" : contactId} />
      <input type="hidden" name="newVendor" value={isNew ? JSON.stringify(newVendor) : ""} />
      <input type="hidden" name="lines" value={linesPayload} />
      <input type="hidden" name="intent" defaultValue="draft" ref={intentRef} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor" hint="Who sent the bill.">
          <Select id={`${uid}-vendor`} value={contactId} onChange={(e) => chooseVendor(e.target.value)} aria-label="Vendor" required>
            <option value="">Choose a vendor…</option>
            {options.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName}
              </option>
            ))}
            <option value={NEW_VENDOR}>＋ Add a new vendor…</option>
          </Select>
        </Field>
        <Field label="Vendor's invoice number" hint="Optional. Helps you find it later.">
          <Input name="vendorInvoiceNumber" maxLength={100} defaultValue={initial?.vendorInvoiceNumber ?? ""} />
        </Field>
      </div>

      {isNew ? (
        <div className="grid gap-4 rounded-2xl bg-alabaster p-4 sm:grid-cols-2" data-testid="new-vendor">
          <Field label="New vendor name">
            <Input value={newVendor.displayName} maxLength={200} required onChange={(e) => setNewVendor({ ...newVendor, displayName: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select value={newVendor.kind} onChange={(e) => setNewVendor({ ...newVendor, kind: e.target.value })} aria-label="Vendor type">
              <option value="organization">Business or organization</option>
              <option value="individual">Person</option>
            </Select>
          </Field>
          <Field label="Email (optional)">
            <Input type="email" value={newVendor.email} onChange={(e) => setNewVendor({ ...newVendor, email: e.target.value })} />
          </Field>
          <Field label="Phone (optional)">
            <Input type="tel" value={newVendor.phone} onChange={(e) => setNewVendor({ ...newVendor, phone: e.target.value })} />
          </Field>
          <p className="text-xs text-stone-500 sm:col-span-2">You can add the address and tax details later from the vendor&apos;s page.</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Bill date">
          <Input
            type="date"
            name="billDate"
            required
            value={billDate}
            onChange={(e) => {
              setBillDate(e.target.value);
              if (!dueTouched && e.target.value) setDueDate(defaultDueDate(e.target.value));
            }}
          />
        </Field>
        <Field label="Due date" hint="Usually 30 days after the bill date.">
          <Input
            type="date"
            name="dueDate"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value);
              setDueTouched(true);
            }}
          />
        </Field>
        <Field label="Program" hint={options.orgWide ? "Optional. Limits who can see this bill." : "Required."}>
          <Select name="programId" value={programId} onChange={(e) => changeProgram(e.target.value)} required={!options.orgWide} aria-label="Program">
            {options.orgWide ? <option value="">Whole organization</option> : <option value="">Choose your program…</option>}
            {options.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="What is this bill for?" hint="A short description, e.g. “Spring equipment order”.">
        <Textarea name="memo" required maxLength={500} rows={2} defaultValue={initial?.memo ?? ""} />
      </Field>

      <div className="space-y-3">
        <h2 className="text-base font-bold text-charcoal">What was bought</h2>
        <ul className="space-y-3">
          {lines.map((l, i) => {
            const bad = parseMoney(l.amount) === null;
            return (
              <li key={l.key} data-testid="bill-line" className="rounded-2xl border border-line bg-white p-3.5 sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-500">Line {i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                    disabled={lines.length <= 1}
                    aria-label={`Remove line ${i + 1}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-alabaster hover:text-rose-700 disabled:pointer-events-none disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="min-w-0 sm:col-span-2">
                    <Label htmlFor={`${uid}-a-${l.key}`}>Category</Label>
                    <Select id={`${uid}-a-${l.key}`} value={l.accountId} onChange={(e) => update(l.key, { accountId: e.target.value })} required aria-label={`Category for line ${i + 1}`}>
                      <option value="">Choose a category…</option>
                      {accountGroups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} · {a.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor={`${uid}-f-${l.key}`}>Fund</Label>
                    <Select id={`${uid}-f-${l.key}`} value={l.fundId} onChange={(e) => update(l.key, { fundId: e.target.value })} aria-label={`Fund for line ${i + 1}`}>
                      {options.funds.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                          {f.restriction === "with_donor_restrictions" ? " (restricted)" : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor={`${uid}-p-${l.key}`}>Program</Label>
                    <Select id={`${uid}-p-${l.key}`} value={l.programId} onChange={(e) => update(l.key, { programId: e.target.value })} required={!options.orgWide} aria-label={`Program for line ${i + 1}`}>
                      {options.orgWide ? <option value="">Whole organization</option> : <option value="">Choose…</option>}
                      {options.programs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <Label htmlFor={`${uid}-m-${l.key}`}>Amount ($)</Label>
                    <Input
                      id={`${uid}-m-${l.key}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={l.amount}
                      required
                      aria-invalid={bad}
                      aria-label={`Amount for line ${i + 1}`}
                      onChange={(e) => update(l.key, { amount: e.target.value })}
                      className="text-right tabular-nums"
                    />
                  </div>
                  <div className="min-w-0 sm:col-span-2 lg:col-span-6">
                    <Input
                      value={l.description}
                      maxLength={500}
                      placeholder="Note for this line (optional)"
                      aria-label={`Note for line ${i + 1}`}
                      onChange={(e) => update(l.key, { description: e.target.value })}
                    />
                  </div>
                </div>
                {bad ? (
                  <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
                    Enter an amount like 25 or 25.00.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" size="sm" onClick={() => setLines([...lines, blankLine(options, programId)])}>
            <Plus className="h-4 w-4" /> Add a line
          </Button>
          <p className="rounded-xl bg-alabaster px-3.5 py-2 text-sm font-bold tabular-nums" data-testid="bill-total">
            Total {money(total)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-files`}>{editing ? "Add more files" : "Attach the bill"} (optional)</Label>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line bg-alabaster/50 px-3.5 py-2.5 text-sm text-stone-600">
          <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
          <input
            id={`${uid}-files`}
            type="file"
            name="files"
            multiple
            accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
            className="min-w-0 flex-1 text-xs file:mr-3 file:rounded-full file:border-0 file:bg-charcoal file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
        </label>
        <p className="text-xs text-stone-400">PDF or photo, 10 MB or smaller each.</p>
      </div>

      <FormError state={state} />
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" disabled={pending || total <= 0} data-testid="save-draft" onClick={() => intentRef.current && (intentRef.current.value = "draft")}>
          Save draft
        </Button>
        <Button type="submit" disabled={pending || total <= 0} data-testid="save-submit" onClick={() => intentRef.current && (intentRef.current.value = "submit")}>
          {pending ? "Saving..." : "Save and submit for approval"}
        </Button>
      </div>
    </form>
  );
}
