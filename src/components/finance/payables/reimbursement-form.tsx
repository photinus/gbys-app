"use client";

import { Camera, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { submitReimbursementAction } from "@/app/(portal)/reimbursements/actions";
import { money, parseMoney } from "@/components/finance/gl/format";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import type { ReimbursementOptions } from "@/lib/dal/finance-bills";

interface Item {
  key: string;
  description: string;
  amount: string;
}
let seq = 0;
const blank = (): Item => ({ key: `i${++seq}`, description: "", amount: "" });

/** A member's reimbursement claim: what they paid for, how much, and a photo of the receipt. */
export function ReimbursementForm({ options, today }: { options: ReimbursementOptions; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm<{ id: string }>(submitReimbursementAction);
  const [items, setItems] = useState<Item[]>(() => [blank()]);
  const [fileCount, setFileCount] = useState(0);
  const total = useMemo(() => items.reduce((s, i) => s + (parseMoney(i.amount) ?? 0), 0), [items]);
  const payload = useMemo(
    () => JSON.stringify(items.map((i) => ({ description: i.description, amountCents: parseMoney(i.amount) ?? 0 }))),
    [items]
  );
  const mine = options.programs.filter((p) => options.myProgramIds.includes(p.id));
  const others = options.programs.filter((p) => !options.myProgramIds.includes(p.id));

  useEffect(() => {
    if (state?.ok) {
      toast.success("Claim sent. We'll email you when it's been reviewed.");
      router.push(`/reimbursements/${state.data.id}`);
    }
  }, [state, toast, router]);

  const update = (key: string, patch: Partial<Item>) => setItems((is) => is.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  return (
    <form onSubmit={onSubmit} className="space-y-6 text-sm" data-testid="claim-form">
      <input type="hidden" name="lines" value={payload} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date you paid">
          <Input type="date" name="claimDate" required max={today} defaultValue={today} />
        </Field>
        <Field label="Program (optional)" hint="Which program was this for?">
          <Select name="programId" defaultValue="" aria-label="Program">
            <option value="">Not for a specific program</option>
            {mine.length > 0 ? (
              <optgroup label="Your programs">
                {mine.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            <optgroup label={mine.length > 0 ? "Other programs" : "Programs"}>
              {others.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
      </div>
      <Field label="What was this for?" hint="A short description, e.g. “Pizza for the team banquet”.">
        <Textarea name="memo" required rows={2} maxLength={500} />
      </Field>

      <div className="space-y-3">
        <h2 className="text-base font-bold text-charcoal">What you paid for</h2>
        <ul className="space-y-3">
          {items.map((it, i) => (
            <li key={it.key} className="rounded-2xl border border-line p-3.5" data-testid="claim-item">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
                <Field label={`Item ${i + 1}`}>
                  <Input value={it.description} required maxLength={500} placeholder="e.g. 2 large pizzas" onChange={(e) => update(it.key, { description: e.target.value })} />
                </Field>
                <Field label="Amount ($)" error={parseMoney(it.amount) === null ? "Like 25 or 25.00" : undefined}>
                  <Input inputMode="decimal" required placeholder="0.00" value={it.amount} onChange={(e) => update(it.key, { amount: e.target.value })} className="text-right tabular-nums" />
                </Field>
                <button
                  type="button"
                  onClick={() => setItems(items.filter((x) => x.key !== it.key))}
                  disabled={items.length <= 1}
                  aria-label={`Remove item ${i + 1}`}
                  className="flex h-9 w-9 items-center justify-center self-end rounded-full text-stone-400 hover:bg-alabaster hover:text-rose-700 disabled:pointer-events-none disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" size="sm" onClick={() => setItems([...items, blank()])}>
            <Plus className="h-4 w-4" /> Add another item
          </Button>
          <p className="rounded-xl bg-alabaster px-3.5 py-2 text-sm font-bold tabular-nums" data-testid="claim-total">
            Total {money(total)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="claim-receipts" className="block text-sm font-semibold text-charcoal">
          Photo of your receipt
        </label>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line bg-alabaster/50 px-3.5 py-3 text-sm text-stone-600">
          <Camera className="h-4 w-4 shrink-0" aria-hidden />
          <input
            id="claim-receipts"
            type="file"
            name="files"
            multiple
            required
            accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
            onChange={(e) => setFileCount(e.target.files?.length ?? 0)}
            className="min-w-0 flex-1 text-xs file:mr-3 file:rounded-full file:border-0 file:bg-charcoal file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
        </label>
        <p className="text-xs text-stone-500">
          {fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"} chosen. ` : ""}At least one is required. Take a clear photo or upload a PDF (10 MB or smaller each).
        </p>
      </div>

      <FormError state={state} />
      <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || total <= 0} data-testid="send-claim">
          {pending ? "Sending..." : `Send claim for ${money(total)}`}
        </Button>
      </div>
    </form>
  );
}
