"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import type { PostingOptions } from "@/lib/dal/finance-accounts";
import { ACCOUNT_TYPE_LABELS } from "@/lib/validation/finance-gl";
import { cn } from "@/lib/utils";
import { money, parseMoney } from "./format";

export interface EditorLine {
  key: string;
  accountId: string;
  fundId: string;
  programId: string;
  debit: string;
  credit: string;
  description: string;
}

export interface LinePayload {
  accountId: string;
  fundId: string;
  programId: string;
  debitCents: number;
  creditCents: number;
  description: string;
}

let seq = 0;
export function newLine(partial: Partial<EditorLine> = {}, generalFundId = ""): EditorLine {
  seq += 1;
  return {
    key: `l${seq}-${Math.random().toString(36).slice(2, 7)}`,
    accountId: "",
    fundId: generalFundId,
    programId: "",
    debit: "",
    credit: "",
    description: "",
    ...partial,
  };
}

/** Lines from a saved entry (cents) to editor rows. */
export function linesFromCents(
  lines: { accountId: string; fundId: string; programId: string | null; debitCents: number; creditCents: number; description: string | null }[]
): EditorLine[] {
  return lines.map((l) =>
    newLine({
      accountId: l.accountId,
      fundId: l.fundId,
      programId: l.programId ?? "",
      debit: l.debitCents ? (l.debitCents / 100).toFixed(2) : "",
      credit: l.creditCents ? (l.creditCents / 100).toFixed(2) : "",
      description: l.description ?? "",
    })
  );
}

function isBlank(l: EditorLine) {
  return !l.accountId && !l.debit.trim() && !l.credit.trim() && !l.description.trim();
}

/** Payload for the server: blank rows dropped; unreadable amounts become 0 (the server then rejects the row). */
export function toPayload(lines: EditorLine[]): LinePayload[] {
  return lines
    .filter((l) => !isBlank(l))
    .map((l) => ({
      accountId: l.accountId,
      fundId: l.fundId,
      programId: l.programId,
      debitCents: parseMoney(l.debit) ?? 0,
      creditCents: parseMoney(l.credit) ?? 0,
      description: l.description,
    }));
}

export function editorTotals(lines: EditorLine[]) {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += parseMoney(l.debit) ?? 0;
    credit += parseMoney(l.credit) ?? 0;
  }
  return { debit, credit, diff: debit - credit };
}

/**
 * Reusable multi-line journal editor. Renders rows (account, fund, program, debit, credit, note),
 * a live "out of balance" indicator and a hidden `<input name={name}>` carrying the JSON payload
 * (cents) for the server action. Mobile friendly: each row is a stacked card below `lg`.
 */
export function LinesEditor({
  options,
  initialLines,
  name = "lines",
  lines: controlled,
  onChange,
}: {
  options: PostingOptions;
  initialLines?: EditorLine[];
  name?: string;
  /** Optional controlled mode. */
  lines?: EditorLine[];
  onChange?: (lines: EditorLine[]) => void;
}) {
  const uid = useId();
  const [inner, setInner] = useState<EditorLine[]>(
    () => initialLines ?? [newLine({}, options.generalFundId), newLine({}, options.generalFundId)]
  );
  const lines = controlled ?? inner;
  const set = (next: EditorLine[]) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  };
  const update = (key: string, patch: Partial<EditorLine>) =>
    set(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totals = useMemo(() => editorTotals(lines), [lines]);
  const payload = useMemo(() => JSON.stringify(toPayload(lines)), [lines]);
  const balanced = totals.diff === 0 && totals.debit > 0;

  return (
    <div className="space-y-3" data-testid="lines-editor">
      <input type="hidden" name={name} value={payload} />
      <ul className="space-y-3">
        {lines.map((l, i) => {
          const debitBad = parseMoney(l.debit) === null;
          const creditBad = parseMoney(l.credit) === null;
          return (
            <li
              key={l.key}
              data-testid="editor-line"
              className="rounded-2xl border border-line bg-white p-3.5 sm:p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-500">Line {i + 1}</span>
                <button
                  type="button"
                  onClick={() => set(lines.filter((x) => x.key !== l.key))}
                  disabled={lines.length <= 2}
                  aria-label={`Remove line ${i + 1}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-alabaster hover:text-rose-700 disabled:pointer-events-none disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="min-w-0 sm:col-span-2 lg:col-span-2">
                  <Label htmlFor={`${uid}-a-${l.key}`}>Account (category)</Label>
                  <Select
                    id={`${uid}-a-${l.key}`}
                    value={l.accountId}
                    onChange={(e) => update(l.key, { accountId: e.target.value })}
                    aria-label={`Account for line ${i + 1}`}
                  >
                    <option value="">Choose an account…</option>
                    {options.accountGroups.map((g) => (
                      <optgroup key={g.type} label={ACCOUNT_TYPE_LABELS[g.type]}>
                        {g.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </div>
                <div className="min-w-0 lg:col-span-1">
                  <Label htmlFor={`${uid}-f-${l.key}`}>Fund</Label>
                  <Select
                    id={`${uid}-f-${l.key}`}
                    value={l.fundId}
                    onChange={(e) => update(l.key, { fundId: e.target.value })}
                    aria-label={`Fund for line ${i + 1}`}
                  >
                    {options.funds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                        {f.restriction === "with_donor_restrictions" ? " (restricted)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="min-w-0 lg:col-span-1">
                  <Label htmlFor={`${uid}-p-${l.key}`}>Program</Label>
                  <Select
                    id={`${uid}-p-${l.key}`}
                    value={l.programId}
                    onChange={(e) => update(l.key, { programId: e.target.value })}
                    aria-label={`Program for line ${i + 1}`}
                  >
                    <option value="">Whole organization</option>
                    {options.programs.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:col-span-2 lg:col-span-2">
                  <div className="min-w-0">
                    <Label htmlFor={`${uid}-d-${l.key}`}>Debit ($)</Label>
                    <Input
                      id={`${uid}-d-${l.key}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={l.debit}
                      aria-invalid={debitBad}
                      aria-label={`Debit for line ${i + 1}`}
                      onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value.trim() ? "" : l.credit })}
                      className="text-right tabular-nums"
                    />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor={`${uid}-c-${l.key}`}>Credit ($)</Label>
                    <Input
                      id={`${uid}-c-${l.key}`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={l.credit}
                      aria-invalid={creditBad}
                      aria-label={`Credit for line ${i + 1}`}
                      onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value.trim() ? "" : l.debit })}
                      className="text-right tabular-nums"
                    />
                  </div>
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
              {(debitBad || creditBad) && (
                <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
                  Enter an amount like 25 or 25.00.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" size="sm" onClick={() => set([...lines, newLine({}, options.generalFundId)])}>
          <Plus className="h-4 w-4" /> Add a line
        </Button>
        <div
          data-testid="balance-status"
          role="status"
          className={cn(
            "rounded-xl px-3.5 py-2 text-xs font-semibold",
            balanced ? "bg-sage/40 text-emerald-900" : "bg-amber-soft/45 text-amber-950"
          )}
        >
          <span className="tabular-nums">
            Debits {money(totals.debit)} · Credits {money(totals.credit)}
          </span>
          <span className="mx-2 text-stone-400">|</span>
          {balanced ? (
            "Balanced"
          ) : totals.debit === 0 && totals.credit === 0 ? (
            "Enter amounts"
          ) : (
            <span data-testid="out-of-balance">
              Out of balance by {money(Math.abs(totals.diff))} ({totals.diff > 0 ? "needs more credit" : "needs more debit"})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
