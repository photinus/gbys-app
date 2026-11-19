"use client";

import { useState } from "react";
import { Button, Field, Input, Label, Modal, Select, Switch } from "@/components/ui";
import { saveRuleAction } from "@/app/(portal)/finance/banking/actions";
import type { BankingOptions, InboxRow } from "@/lib/dal/finance-banking";
import { dollarsToCents } from "@/lib/validation/rosters";
import { FundSelect, ProgramSelect } from "./categorize-modal";
import { CategoryOptions } from "./shared";
import { useRunner } from "./use-runner";

export interface RuleDraft {
  id: string | null;
  name: string;
  priority: number;
  matchField: "description" | "payee";
  matchType: "contains" | "equals" | "starts_with";
  matchText: string;
  direction: "any" | "deposit" | "withdrawal";
  minAmountCents: number | null;
  maxAmountCents: number | null;
  bankAccountId: string | null;
  accountId: string;
  fundId: string | null;
  programId: string | null;
  memo: string | null;
  autoPost: boolean;
  isActive: boolean;
}

export function emptyRule(): RuleDraft {
  return {
    id: null, name: "", priority: 100, matchField: "description", matchType: "contains", matchText: "", direction: "any",
    minAmountCents: null, maxAmountCents: null, bankAccountId: null, accountId: "", fundId: null, programId: null, memo: null,
    autoPost: false, isActive: true,
  };
}

/** Prefill for "Make a rule from this transaction". */
export function ruleFromTxn(row: InboxRow): RuleDraft {
  const base = (row.payee ?? row.description).trim();
  // Drop trailing reference numbers ("OFFICE DEPOT #1234" -> "OFFICE DEPOT") so the rule keeps matching.
  const cleaned = base.replace(/\s*[#*]?\s*\d{3,}.*$/, "").trim() || base;
  return {
    ...emptyRule(),
    name: cleaned.slice(0, 60),
    matchField: row.payee ? "payee" : "description",
    matchText: cleaned.slice(0, 200),
    direction: row.amountCents > 0 ? "deposit" : "withdrawal",
  };
}

const centsToInput = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));

export function RuleModal({ draft, options, onClose }: { draft: RuleDraft | null; options: BankingOptions; onClose: () => void }) {
  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={draft?.id ? "Edit rule" : "New rule"}
      description="Rules sort matching bank transactions for you. The first matching rule (top of the list) wins."
    >
      {draft ? <RuleForm key={draft.id ?? "new"} draft={draft} options={options} onDone={onClose} /> : null}
    </Modal>
  );
}

function RuleForm({ draft, options, onDone }: { draft: RuleDraft; options: BankingOptions; onDone: () => void }) {
  const { run, pending, error } = useRunner({ inline: true });
  const [v, setV] = useState({
    ...draft,
    fundId: draft.fundId ?? "",
    programId: draft.programId ?? "",
    bankAccountId: draft.bankAccountId ?? "",
    memo: draft.memo ?? "",
    min: centsToInput(draft.minAmountCents),
    max: centsToInput(draft.maxAmountCents),
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const min = v.min.trim() === "" ? null : dollarsToCents(v.min);
    const max = v.max.trim() === "" ? null : dollarsToCents(v.max);
    if (v.min.trim() !== "" && min === null) return setLocalError("Enter the smallest amount as dollars, e.g. 25.00.");
    if (v.max.trim() !== "" && max === null) return setLocalError("Enter the largest amount as dollars, e.g. 500.00.");
    if (!v.accountId) return setLocalError("Choose a category.");
    run(
      () =>
        saveRuleAction({
          id: v.id,
          name: v.name,
          priority: Number(v.priority) || 100,
          matchField: v.matchField,
          matchType: v.matchType,
          matchText: v.matchText,
          direction: v.direction,
          minAmountCents: min,
          maxAmountCents: max,
          bankAccountId: v.bankAccountId || null,
          accountId: v.accountId,
          fundId: v.fundId || null,
          programId: v.programId || null,
          memo: v.memo || null,
          autoPost: v.autoPost,
          isActive: v.isActive,
        }),
      () => {
        onDone();
        return v.id ? "Rule updated." : "Rule created.";
      }
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 text-sm" data-testid="rule-form">
      <Field label="Rule name">
        <Input value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={100} data-testid="rule-name" />
      </Field>
      <fieldset className="space-y-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-stone-600">When a transaction&apos;s…</legend>
        <div className="grid grid-cols-2 gap-3">
          <Select aria-label="Field" value={v.matchField} onChange={(e) => set("matchField", e.target.value as "description" | "payee")}>
            <option value="description">description</option>
            <option value="payee">payee</option>
          </Select>
          <Select aria-label="Match type" value={v.matchType} onChange={(e) => set("matchType", e.target.value as "contains")}>
            <option value="contains">contains</option>
            <option value="starts_with">starts with</option>
            <option value="equals">is exactly</option>
          </Select>
        </div>
        <Input aria-label="Text to look for" placeholder="Text to look for" value={v.matchText} onChange={(e) => set("matchText", e.target.value)} maxLength={200} data-testid="rule-text" />
        <div className="grid grid-cols-2 gap-3">
          <Select aria-label="Direction" value={v.direction} onChange={(e) => set("direction", e.target.value as "any")}>
            <option value="any">Money in or out</option>
            <option value="deposit">Money in only</option>
            <option value="withdrawal">Money out only</option>
          </Select>
          <Select aria-label="Bank account" value={v.bankAccountId} onChange={(e) => set("bankAccountId", e.target.value)}>
            <option value="">Any bank account</option>
            {options.feedAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input aria-label="Smallest amount" inputMode="decimal" placeholder="Smallest $ (optional)" value={v.min} onChange={(e) => set("min", e.target.value)} />
          <Input aria-label="Largest amount" inputMode="decimal" placeholder="Largest $ (optional)" value={v.max} onChange={(e) => set("max", e.target.value)} />
        </div>
      </fieldset>
      <fieldset className="space-y-3 rounded-xl border border-line p-3">
        <legend className="px-1 text-xs font-semibold text-stone-600">…then sort it as</legend>
        <Select aria-label="Category" value={v.accountId} onChange={(e) => set("accountId", e.target.value)} data-testid="rule-category">
          <option value="">Category…</option>
          <CategoryOptions categories={options.categories} deposit={v.direction !== "withdrawal"} />
        </Select>
        <div className="grid gap-3 sm:grid-cols-2">
          <FundSelect options={options} value={v.fundId} onChange={(x) => set("fundId", x)} />
          <ProgramSelect options={options} value={v.programId} onChange={(x) => set("programId", x)} />
        </div>
        <Input aria-label="Note" placeholder="Note on each entry (optional)" value={v.memo} onChange={(e) => set("memo", e.target.value)} maxLength={300} />
      </fieldset>
      <div className="flex items-start justify-between gap-4">
        <div>
          <Label htmlFor="rule-auto" className="mb-0 text-sm font-medium text-charcoal">
            Post automatically
          </Label>
          <p className="text-xs text-stone-500">Off: the rule only suggests, and you confirm. On: matching transactions are posted without review.</p>
        </div>
        <Switch id="rule-auto" checked={v.autoPost} onChange={(e) => set("autoPost", e.target.checked)} data-testid="rule-auto" />
      </div>
      {v.id ? (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="rule-active" className="mb-0 text-sm font-medium text-charcoal">
            Rule is on
          </Label>
          <Switch id="rule-active" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} />
        </div>
      ) : null}
      {localError || error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {localError ?? error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} data-testid="rule-submit">
          {pending ? "Saving…" : "Save rule"}
        </Button>
      </div>
    </form>
  );
}
