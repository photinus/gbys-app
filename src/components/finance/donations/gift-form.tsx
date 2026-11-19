"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { recordGiftAction, updateGiftAction } from "@/app/(portal)/finance/donations/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import type { GiftEditValues, GiftFormOptions } from "@/lib/dal/finance-donations";
import { GIFT_KIND_LABELS } from "@/lib/finance/receipt-content";
import { GIFT_KINDS, type GiftKind } from "@/lib/validation/finance-donations";
import { DonorPicker, type PickedDonor } from "./donor-picker";

const centsToInput = (c: number) => (c / 100).toFixed(2);

export interface GiftFormBankTxn {
  id: string;
  date: string;
  amountCents: number;
  description: string;
}

export function GiftForm({
  options,
  today,
  initial,
  initialDonor,
  bankTxn,
}: {
  options: GiftFormOptions;
  today: string;
  /** Present = edit an existing gift. */
  initial?: GiftEditValues;
  initialDonor?: PickedDonor | null;
  bankTxn?: GiftFormBankTxn | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = !!initial;
  const { state, pending, onSubmit } = useActionForm(editing ? updateGiftAction : recordGiftAction);
  const d = options.defaults;

  const [donorMode, setDonorMode] = useState<"existing" | "new" | "anonymous">(
    editing ? (initial.donorContactId ? "existing" : "anonymous") : "existing"
  );
  const [kind, setKind] = useState<GiftKind>(initial?.kind ?? "check");
  const [fundId, setFundId] = useState(initial?.fundId ?? d.generalFundId);
  const [programId, setProgramId] = useState(initial?.programId ?? "");
  const primaryIds = new Set(options.revenuePrimary.map((a) => a.id));
  const initialRevenue = initial && initial.kind !== "in_kind" ? initial.revenueAccountId : d.revenueAccountId;
  const [revenueChoice, setRevenueChoice] = useState(primaryIds.has(initialRevenue) ? initialRevenue : "__other__");
  const [revenueOther, setRevenueOther] = useState(primaryIds.has(initialRevenue) ? "" : initialRevenue);
  const defaultDeposit = (k: GiftKind) => (k === "cash" || k === "check" ? d.undepositedAccountId : d.stripeBankAccountId);
  const [deposit, setDeposit] = useState(initial?.depositAccountId ?? defaultDeposit(kind));
  const [depositTouched, setDepositTouched] = useState(!!initial);
  const [gsOpen, setGsOpen] = useState((initial?.goodsServicesCents ?? 0) > 0);

  const inKind = kind === "in_kind";
  const bankLinked = !!bankTxn || !!initial?.bankLinked;
  const fund = options.funds.find((f) => f.id === fundId);

  useEffect(() => {
    if (state?.ok) {
      const id = (state.data as { id: string }).id;
      toast.success(editing ? "Gift updated" : "Gift recorded");
      router.push(`/finance/donations/${id}`);
    }
  }, [state, toast, router, editing]);

  function onKind(k: GiftKind) {
    setKind(k);
    if (k === "in_kind" && donorMode === "anonymous") setDonorMode("existing");
    if (!depositTouched && k !== "in_kind") setDeposit(defaultDeposit(k));
  }
  function onFund(id: string) {
    setFundId(id);
    const f = options.funds.find((x) => x.id === id);
    setProgramId(f?.programId ?? "");
  }

  const kinds = editing ? GIFT_KINDS.filter((k) => (k === "in_kind") === (initial.kind === "in_kind")) : GIFT_KINDS;
  const radio = "flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm has-[:checked]:border-charcoal has-[:checked]:bg-alabaster";

  return (
    <form onSubmit={onSubmit} className="space-y-6 text-sm" data-testid="gift-form">
      {editing ? <input type="hidden" name="giftId" value={initial.id} /> : null}
      {bankTxn ? <input type="hidden" name="bankTxnId" value={bankTxn.id} /> : null}

      {bankTxn ? (
        <p className="rounded-xl bg-periwinkle/20 px-3.5 py-2.5 text-xs text-indigo-950" data-testid="bank-banner">
          Recording from a bank deposit: <strong>{bankTxn.description}</strong> ({centsToInput(bankTxn.amountCents)}). The amount and deposit account come from the bank transaction.
        </p>
      ) : null}
      {editing && initial.receiptCount > 0 ? (
        <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950" data-testid="edit-receipt-warning">
          A receipt was already sent for this gift. If you change the amount or donor, the old receipt will be marked “out of date” so you can send a corrected one.
        </p>
      ) : null}
      {editing && initial.bankLinked ? (
        <p className="rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600">
          This gift came from a bank transaction, so its amount and deposit account can&apos;t change here.
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-bold">Who gave?</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={radio}>
            <input type="radio" name="donorMode" value="existing" checked={donorMode === "existing"} onChange={() => setDonorMode("existing")} /> Someone in our records
          </label>
          <label className={radio}>
            <input type="radio" name="donorMode" value="new" checked={donorMode === "new"} onChange={() => setDonorMode("new")} data-testid="mode-new" /> New donor
          </label>
          <label className={`${radio} ${inKind ? "opacity-50" : ""}`}>
            <input type="radio" name="donorMode" value="anonymous" checked={donorMode === "anonymous"} onChange={() => setDonorMode("anonymous")} disabled={inKind} /> Anonymous
          </label>
        </div>
        {donorMode === "existing" ? <DonorPicker initial={initialDonor ?? null} /> : null}
        {donorMode === "new" ? (
          <div className="grid gap-4 rounded-2xl border border-line-soft p-4 sm:grid-cols-2">
            <Field label="Name">
              <Input name="nd_displayName" required maxLength={200} autoComplete="off" data-testid="nd-name" />
            </Field>
            <Field label="Type">
              <Select name="nd_kind" defaultValue="individual">
                <option value="individual">Individual</option>
                <option value="organization">Business or organization</option>
              </Select>
            </Field>
            <Field label="Email" hint="Needed to email receipts.">
              <Input name="nd_email" type="email" maxLength={254} data-testid="nd-email" />
            </Field>
            <Field label="Address" hint="For printed receipts.">
              <Input name="nd_addressLine1" maxLength={200} autoComplete="off" />
            </Field>
            <Field label="Address line 2">
              <Input name="nd_addressLine2" maxLength={200} />
            </Field>
            <Field label="City">
              <Input name="nd_city" maxLength={100} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="State">
                <Input name="nd_state" maxLength={50} />
              </Field>
              <Field label="ZIP code">
                <Input name="nd_postalCode" maxLength={20} />
              </Field>
            </div>
          </div>
        ) : null}
        {donorMode === "anonymous" ? (
          <p className="rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600">
            With no donor on record, this gift is counted in the books but can&apos;t be sent a receipt.
          </p>
        ) : (
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <input type="checkbox" name="isAnonymous" defaultChecked={initial?.isAnonymous ?? false} /> Donor asked to stay anonymous (hide their name in public lists)
          </label>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-bold">The gift</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="How was it given?">
            <Select name="kind" value={kind} onChange={(e) => onKind(e.target.value as GiftKind)} data-testid="gift-kind">
              {kinds.map((k) => (
                <option key={k} value={k} disabled={!!bankTxn && k === "in_kind"}>
                  {GIFT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date received" hint="The day the gift came in.">
            <Input type="date" name="giftDate" required defaultValue={initial?.giftDate ?? bankTxn?.date ?? today} data-testid="gift-date" />
          </Field>
          <Field label={inKind ? "Fair value (for our books only)" : "Amount"} hint={inKind ? "Not shown on the receipt. The donor decides the value for their taxes." : undefined}>
            <Input
              name="amount"
              inputMode="decimal"
              required
              placeholder="0.00"
              defaultValue={bankTxn ? centsToInput(bankTxn.amountCents) : initial ? centsToInput(initial.amountCents) : ""}
              readOnly={bankLinked}
              data-testid="gift-amount"
            />
          </Field>
          {kind === "check" || kind === "other" || kind === "ach" ? (
            <Field label={kind === "check" ? "Check number" : "Reference"}>
              <Input name="reference" maxLength={100} defaultValue={initial?.reference ?? ""} data-testid="gift-reference" />
            </Field>
          ) : (
            <input type="hidden" name="reference" value="" />
          )}
        </div>

        {inKind ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What was donated?" hint="This description appears on the receipt, without a value." className="sm:col-span-2">
              <Textarea name="inKindDescription" required rows={2} maxLength={1000} defaultValue={initial?.inKindDescription ?? ""} data-testid="inkind-description" />
            </Field>
            <Field label="Record it as" hint="Usually an in-kind expense. Choose an asset account for equipment we will keep.">
              <Select name="inKindDebitAccountId" defaultValue={initial?.inKindDebitAccountId ?? d.inKindDebitAccountId}>
                {options.inKindDebitAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" hint="Where this shows in reports.">
              <Select name="revenueAccountId" value={revenueChoice} onChange={(e) => setRevenueChoice(e.target.value)} data-testid="gift-revenue">
                {options.revenuePrimary.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value="__other__">Other revenue category…</option>
              </Select>
            </Field>
            {revenueChoice === "__other__" ? (
              <Field label="Other category">
                <Select name="revenueAccountOther" value={revenueOther} onChange={(e) => setRevenueOther(e.target.value)} required>
                  <option value="">Choose…</option>
                  {options.revenueOther.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {bankTxn || initial?.bankLinked ? (
              <p className="rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600 sm:col-span-2">Deposited to the bank account this transaction came from.</p>
            ) : (
              <Field label="Deposited to" hint="Checks and cash start in Undeposited funds until they hit the bank.">
                <Select
                  name="depositAccountId"
                  value={deposit}
                  onChange={(e) => {
                    setDeposit(e.target.value);
                    setDepositTouched(true);
                  }}
                  data-testid="gift-deposit"
                >
                  {options.depositAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-bold">Fund and program</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fund" hint={fund?.restricted ? "Donor-restricted: the money must be used for its purpose." : "General Fund is money we can use for anything."}>
            <Select name="fundId" value={fundId} onChange={(e) => onFund(e.target.value)} data-testid="gift-fund">
              {options.funds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.restricted ? " (restricted)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Program" hint={fund?.programId ? "Set from the fund's program." : "Leave blank for the whole organization."}>
            <Select name="programId" value={programId} onChange={(e) => setProgramId(e.target.value)} data-testid="gift-program">
              <option value="">No specific program</option>
              {options.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campaign (optional)" hint="e.g. Spring Drive">
            <Input name="campaign" list="campaign-list" maxLength={100} defaultValue={initial?.campaign ?? ""} />
            <datalist id="campaign-list">
              {options.campaigns.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <details open={gsOpen} onToggle={(e) => setGsOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-2xl border border-line-soft px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Did the donor get anything in return? (dinner, tickets, merchandise)</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Value of what they received" hint="Good-faith estimate. The rest of the gift is tax-deductible.">
              <Input name="goodsServices" inputMode="decimal" placeholder="0.00" defaultValue={initial && initial.goodsServicesCents > 0 ? centsToInput(initial.goodsServicesCents) : ""} data-testid="gs-amount" />
            </Field>
            <Field label="What did they receive?">
              <Input name="goodsServicesDescription" maxLength={500} placeholder="e.g. dinner for two" defaultValue={initial?.goodsServicesDescription ?? ""} data-testid="gs-description" />
            </Field>
          </div>
        </details>
        <Field label="Note (optional)" hint="Private. Not shown on receipts.">
          <Textarea name="note" rows={2} maxLength={1000} defaultValue={initial?.note ?? ""} />
        </Field>
        {!editing ? (
          <Field label="Attach a check image or letter (optional)" hint="PDF or photo, up to 10 MB each.">
            <Input type="file" name="files" multiple accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" />
          </Field>
        ) : null}
      </section>

      <FormError state={state} />
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} data-testid="save-gift">
          {pending ? "Saving..." : editing ? "Save changes" : "Record gift"}
        </Button>
      </div>
    </form>
  );
}
