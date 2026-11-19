"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input, Modal, Select, Switch, Label } from "@/components/ui";
import { categorizeAction } from "@/app/(portal)/finance/banking/actions";
import type { BankingOptions, InboxRow } from "@/lib/dal/finance-banking";
import { formatCents } from "@/lib/format";
import { dollarsToCents } from "@/lib/validation/rosters";
import { CategoryOptions } from "./shared";
import { useRunner } from "./use-runner";

type Part = { key: number; accountId: string; amount: string; fundId: string; programId: string; memo: string };

export function FundSelect({ options, name, value, onChange }: { options: BankingOptions; name?: string; value: string; onChange: (v: string) => void }) {
  return (
    <Select name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">General Fund</option>
      {options.funds
        .filter((f) => !f.isGeneral)
        .map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.restriction === "with_donor_restrictions" ? " (restricted)" : ""}
          </option>
        ))}
    </Select>
  );
}

export function ProgramSelect({ options, value, onChange }: { options: BankingOptions; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Whole organization</option>
      {options.programs.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

export function CategorizeModal({ row, options, onClose }: { row: InboxRow | null; options: BankingOptions; onClose: () => void }) {
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title="Choose a category"
      description={row ? `${row.description} · ${row.amountCents > 0 ? "Money in" : "Money out"} ${formatCents(Math.abs(row.amountCents))}` : undefined}
    >
      {row ? <CategorizeForm key={row.id} row={row} options={options} onDone={onClose} /> : null}
    </Modal>
  );
}

function CategorizeForm({ row, options, onDone }: { row: InboxRow; options: BankingOptions; onDone: () => void }) {
  const deposit = row.amountCents > 0;
  const abs = Math.abs(row.amountCents);
  const { run, pending, error } = useRunner({ inline: true });
  const [split, setSplit] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [fundId, setFundId] = useState("");
  const [programId, setProgramId] = useState("");
  const [memo, setMemo] = useState("");
  const [nextKey, setNextKey] = useState(3);
  const [parts, setParts] = useState<Part[]>([
    { key: 1, accountId: "", amount: (abs / 100).toFixed(2), fundId: "", programId: "", memo: "" },
    { key: 2, accountId: "", amount: "", fundId: "", programId: "", memo: "" },
  ]);
  const [localError, setLocalError] = useState<string | null>(null);

  const partCents = parts.map((p) => (p.amount.trim() === "" ? 0 : (dollarsToCents(p.amount) ?? NaN)));
  const assigned = partCents.reduce((s, c) => s + (Number.isNaN(c) ? 0 : c), 0);
  const left = abs - assigned;

  const patch = (key: number, p: Partial<Part>) => setParts((ps) => ps.map((x) => (x.key === key ? { ...x, ...p } : x)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    let lines;
    if (!split) {
      if (!accountId) return setLocalError("Choose a category.");
      lines = [{ accountId, fundId: fundId || null, programId: programId || null, amountCents: abs }];
    } else {
      const used = parts.filter((p) => p.amount.trim() !== "" || p.accountId);
      if (used.some((p) => !p.accountId)) return setLocalError("Choose a category for every part.");
      if (used.some((p, i) => Number.isNaN(partCents[parts.indexOf(p)]) || partCents[parts.indexOf(p)] <= 0)) return setLocalError("Enter an amount for every part.");
      if (left !== 0) return setLocalError(`The parts must add up to ${formatCents(abs)}. ${formatCents(Math.abs(left))} ${left > 0 ? "left to assign" : "too much"}.`);
      lines = used.map((p) => ({ accountId: p.accountId, fundId: p.fundId || null, programId: p.programId || null, amountCents: partCents[parts.indexOf(p)], memo: p.memo || null }));
    }
    run(
      () => categorizeAction({ txnId: row.id, memo: memo || null, lines }),
      (r) => {
        onDone();
        return `Saved as journal entry #${r.entryNumber}.`;
      }
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm" data-testid="categorize-form">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-alabaster/50 px-3.5 py-2.5">
        <Label htmlFor="split-switch" className="mb-0 text-sm font-medium text-charcoal">
          Split between several categories
        </Label>
        <Switch id="split-switch" checked={split} onChange={(e) => setSplit(e.target.checked)} />
      </div>

      {!split ? (
        <>
          <Field label="Category">
            <Select name="category" value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="category-select">
              <option value="">Choose…</option>
              <CategoryOptions categories={options.categories} deposit={deposit} />
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fund" hint="Use a restricted fund for money given for a specific purpose.">
              <FundSelect options={options} value={fundId} onChange={setFundId} />
            </Field>
            <Field label="Program" hint="Leave as whole organization for general costs.">
              <ProgramSelect options={options} value={programId} onChange={setProgramId} />
            </Field>
          </div>
        </>
      ) : (
        <div className="space-y-3" data-testid="split-parts">
          {parts.map((p, i) => (
            <div key={p.key} className="space-y-2 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-500">Part {i + 1}</span>
                {parts.length > 2 ? (
                  <button type="button" aria-label="Remove part" onClick={() => setParts((ps) => ps.filter((x) => x.key !== p.key))} className="text-stone-400 hover:text-rose-700">
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <Select aria-label={`Category for part ${i + 1}`} value={p.accountId} onChange={(e) => patch(p.key, { accountId: e.target.value })}>
                <option value="">Category…</option>
                <CategoryOptions categories={options.categories} deposit={deposit} />
              </Select>
              <Input aria-label={`Amount for part ${i + 1}`} inputMode="decimal" placeholder="Amount, e.g. 25.00" value={p.amount} onChange={(e) => patch(p.key, { amount: e.target.value })} />
              <details className="text-xs text-stone-500">
                <summary className="cursor-pointer select-none">Fund, program, note</summary>
                <div className="mt-2 space-y-2">
                  <FundSelect options={options} value={p.fundId} onChange={(v) => patch(p.key, { fundId: v })} />
                  <ProgramSelect options={options} value={p.programId} onChange={(v) => patch(p.key, { programId: v })} />
                  <Input placeholder="Note for this part (optional)" value={p.memo} onChange={(e) => patch(p.key, { memo: e.target.value })} />
                </div>
              </details>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setParts((ps) => [...ps, { key: nextKey, accountId: "", amount: left > 0 ? (left / 100).toFixed(2) : "", fundId: "", programId: "", memo: "" }]);
                setNextKey((k) => k + 1);
              }}
            >
              <Plus className="h-4 w-4" /> Add part
            </Button>
            <span data-testid="split-left" className={left === 0 ? "text-xs font-semibold text-emerald-700" : "text-xs font-semibold text-amber-800"}>
              {left === 0 ? "All assigned" : left > 0 ? `${formatCents(left)} left to assign` : `${formatCents(-left)} too much`}
            </span>
          </div>
        </div>
      )}

      <Field label="Note (optional)" hint="Shown in the journal. Defaults to the bank description.">
        <Input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
      </Field>

      {localError || error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {localError ?? error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} data-testid="categorize-submit">
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
