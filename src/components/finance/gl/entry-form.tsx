"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { postEntryAction, replaceEntryAction } from "@/app/(portal)/finance/journal/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Textarea, useToast } from "@/components/ui";
import type { PostingOptions } from "@/lib/dal/finance-accounts";
import { LinesEditor, editorTotals, linesFromCents, newLine, type EditorLine } from "./lines-editor";

export interface EntryFormInitial {
  entryId: string;
  entryNumber: number;
  entryDate: string;
  memo: string;
  lines: { accountId: string; fundId: string; programId: string | null; debitCents: number; creditCents: number; description: string | null }[];
}

/** New manual entry, or (with `initial`) a correction that replaces an existing one. */
export function EntryForm({
  options,
  today,
  initial,
}: {
  options: PostingOptions;
  today: string;
  initial?: EntryFormInitial;
}) {
  const router = useRouter();
  const toast = useToast();
  const editing = !!initial;
  const { state, pending, onSubmit } = useActionForm(editing ? replaceEntryAction : postEntryAction);
  const [lines, setLines] = useState<EditorLine[]>(
    () => (initial ? linesFromCents(initial.lines) : [newLine({}, options.generalFundId), newLine({}, options.generalFundId)])
  );
  const totals = editorTotals(lines);

  useEffect(() => {
    if (state?.ok) {
      const d = state.data as { entryId: string; entryNumber: number };
      toast.success(editing ? `Saved as entry #${d.entryNumber}` : `Entry #${d.entryNumber} posted`);
      router.push(`/finance/journal/${d.entryId}`);
    }
  }, [state, toast, router, editing]);

  return (
    <form onSubmit={onSubmit} className="space-y-5 text-sm">
      {initial ? <input type="hidden" name="entryId" value={initial.entryId} /> : null}
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <Field label="Date" hint="The day the money moved.">
          <Input type="date" name="entryDate" required defaultValue={initial?.entryDate ?? today} />
        </Field>
        <Field label="What is this for?" hint="A short memo, e.g. “Spring equipment purchase”.">
          <Input name="memo" required minLength={2} maxLength={500} defaultValue={initial?.memo ?? ""} />
        </Field>
      </div>

      <details className="rounded-2xl bg-alabaster px-4 py-3 text-xs text-stone-600">
        <summary className="cursor-pointer font-semibold text-charcoal">How do debits and credits work?</summary>
        <div className="mt-2 space-y-1.5">
          <p>Every entry moves money between accounts, and the total debits must equal the total credits.</p>
          <p>
            <strong>Debit</strong> adds to what we own (cash, equipment) or to an expense.{" "}
            <strong>Credit</strong> adds to money in (revenue), to what we owe, or to net assets.
          </p>
          <p>Example: buying $120 of equipment with the checking account is a debit of $120 to Equipment and a credit of $120 to Checking.</p>
        </div>
      </details>

      <LinesEditor options={options} lines={lines} onChange={setLines} />

      {editing ? (
        <Field label="Why are you changing this entry?" hint="Required. The original is kept, voided, and linked to this correction.">
          <Textarea name="reason" required minLength={3} maxLength={500} rows={2} />
        </Field>
      ) : null}

      <FormError state={state} />
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || totals.diff !== 0 || totals.debit === 0} data-testid="submit-entry">
          {pending ? "Saving..." : editing ? "Save correction" : "Post entry"}
        </Button>
      </div>
    </form>
  );
}
