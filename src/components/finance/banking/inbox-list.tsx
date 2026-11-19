"use client";

import Link from "next/link";
import { ArrowRightLeft, Ban, Check, Link2, ListChecks, RotateCcw, Sparkles, Tags, Undo2, Wand2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, EmptyState, Field, Modal, Select } from "@/components/ui";
import { acceptSuggestionAction, bulkCategorizeAction, restoreAction, undoAction } from "@/app/(portal)/finance/banking/actions";
import type { BankingOptions, InboxRow } from "@/lib/dal/finance-banking";
import { EXCLUDE_REASON_LABELS, type ExcludeReason, type InboxTab } from "@/lib/validation/finance-banking";
import { formatDate } from "@/lib/format";
import { CategorizeModal, FundSelect, ProgramSelect } from "./categorize-modal";
import { RuleModal, ruleFromTxn, type RuleDraft } from "./rule-modal";
import { Amount, CategoryOptions, dateOnly, SOURCE_LABELS } from "./shared";
import { ExcludeModal, MatchModal, TransferModal } from "./txn-modals";
import { useRunner } from "./use-runner";

type Active = { kind: "categorize" | "transfer" | "match" | "exclude"; id: string } | null;

export function InboxList({ rows, options, canEdit, tab }: { rows: InboxRow[]; options: BankingOptions; canEdit: boolean; tab: InboxTab }) {
  const [active, setActive] = useState<Active>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const { run, pending } = useRunner();
  const activeRow = active ? (rows.find((r) => r.id === active.id) ?? null) : null;
  const close = () => setActive(null);

  if (rows.length === 0) {
    return (
      <EmptyState
        title={tab === "new" ? "You're all caught up" : tab === "posted" ? "Nothing posted yet" : "Nothing excluded"}
        description={tab === "new" ? "New bank transactions show up here after each sync." : undefined}
      />
    );
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = tab === "new" && rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div>
      {canEdit && tab === "new" ? (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-500">
          <input
            type="checkbox"
            className="h-4 w-4 accent-charcoal"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            data-testid="select-all"
          />
          Select all on this page
        </label>
      ) : null}
      <ul className="divide-y divide-line-soft" data-testid="inbox-list">
        {rows.map((r) => (
          <li key={r.id} className="flex gap-3 py-3.5" data-testid="inbox-row">
            {canEdit && tab === "new" ? (
              <input
                type="checkbox"
                aria-label={`Select ${r.description}`}
                className="mt-1 h-4 w-4 shrink-0 accent-charcoal"
                checked={selected.has(r.id)}
                onChange={() => toggle(r.id)}
              />
            ) : null}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-charcoal">{r.description}</p>
                  <p className="text-xs text-stone-500">
                    {formatDate(dateOnly(r.postedDate))} · {r.bankAccountName}
                    {r.payee && r.payee !== r.description ? ` · ${r.payee}` : ""}
                  </p>
                </div>
                <Amount cents={r.amountCents} className="shrink-0" />
              </div>

              {tab === "new" ? (
                <>
                  {r.suggestion ? (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600" data-testid="suggestion">
                      <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                      Suggested: <span className="font-semibold text-charcoal">{r.suggestion.accountLabel}</span>
                      <span className="text-stone-400">(rule: {r.suggestion.ruleName})</span>
                    </p>
                  ) : null}
                  {r.candidates.length > 0 ? (
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600" data-testid="possible-match">
                      <Link2 className="h-3.5 w-3.5 text-periwinkle" />
                      Possible match:
                      <span className="font-semibold text-charcoal">
                        #{r.candidates[0].entryNumber} {SOURCE_LABELS[r.candidates[0].source] ?? r.candidates[0].source}
                      </span>
                      {r.candidates.length > 1 ? <span className="text-stone-400">+{r.candidates.length - 1} more</span> : null}
                    </p>
                  ) : null}
                  {canEdit ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" disabled={pending} onClick={() => setActive({ kind: "categorize", id: r.id })} data-testid="btn-categorize">
                        <Tags className="h-3.5 w-3.5" /> Categorize
                      </Button>
                      {r.suggestion ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          data-testid="btn-accept"
                          onClick={() => run(() => acceptSuggestionAction(r.id), (d) => `Saved as journal entry #${d.entryNumber}.`)}
                        >
                          <Check className="h-3.5 w-3.5" /> Accept
                        </Button>
                      ) : null}
                      {r.candidates.length > 0 ? (
                        <Button size="sm" variant="secondary" disabled={pending} onClick={() => setActive({ kind: "match", id: r.id })} data-testid="btn-match">
                          <Link2 className="h-3.5 w-3.5" /> Match
                        </Button>
                      ) : null}
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => setActive({ kind: "transfer", id: r.id })} data-testid="btn-transfer">
                        <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setActive({ kind: "exclude", id: r.id })} data-testid="btn-exclude">
                        <Ban className="h-3.5 w-3.5" /> Exclude
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRuleDraft(ruleFromTxn(r))} data-testid="btn-rule">
                        <Wand2 className="h-3.5 w-3.5" /> Make a rule
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {tab === "posted" ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <Badge tone="success">Posted</Badge>
                  {r.entryId ? (
                    <Link href={`/finance/journal/${r.entryId}`} className="font-semibold text-charcoal underline-offset-2 hover:underline">
                      Entry #{r.entryNumber}
                    </Link>
                  ) : null}
                  <span>{r.entrySource ? (SOURCE_LABELS[r.entrySource] ?? r.entrySource) : ""}</span>
                  {!r.undoVoids ? <span className="text-stone-400">(matched to an existing entry)</span> : null}
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      data-testid="btn-undo"
                      onClick={() => {
                        const msg = r.undoVoids
                          ? "Undo this? The journal entry made from it will be voided and the transaction returns to New."
                          : "Undo this match? The transaction returns to New. The journal entry itself is not changed.";
                        if (window.confirm(msg)) run(() => undoAction(r.id), (d) => (d.voided ? "Entry voided; transaction is back in New." : "Match removed; transaction is back in New."));
                      }}
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Undo
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {tab === "excluded" ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <Badge>{EXCLUDE_REASON_LABELS[(r.excludeReason as ExcludeReason) ?? "other"] ?? "Excluded"}</Badge>
                  {r.excludeNote ? <span className="break-words">{r.excludeNote}</span> : null}
                  {canEdit ? (
                    <Button size="sm" variant="ghost" disabled={pending} data-testid="btn-restore" onClick={() => run(() => restoreAction(r.id), () => "Moved back to New.")}>
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {canEdit && tab === "new" && selected.size > 0 ? (
        <div className="sticky bottom-3 z-10 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-white p-3 shadow-card" data-testid="bulk-bar">
          <span className="text-sm font-semibold text-charcoal">
            <ListChecks className="mr-1.5 inline h-4 w-4" />
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setBulkOpen(true)} data-testid="bulk-categorize">
              Categorize selected
            </Button>
          </div>
        </div>
      ) : null}

      <CategorizeModal row={active?.kind === "categorize" ? activeRow : null} options={options} onClose={close} />
      <TransferModal row={active?.kind === "transfer" ? activeRow : null} options={options} onClose={close} />
      <MatchModal row={active?.kind === "match" ? activeRow : null} onClose={close} />
      <ExcludeModal row={active?.kind === "exclude" ? activeRow : null} onClose={close} />
      <RuleModal draft={ruleDraft} options={options} onClose={() => setRuleDraft(null)} />
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title={`Categorize ${selected.size} transactions`} description="They all get the same category. Money in and money out are handled correctly.">
        {bulkOpen ? (
          <BulkForm
            ids={[...selected]}
            options={options}
            onDone={(failedIds) => {
              setBulkOpen(false);
              setSelected(new Set(failedIds));
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function BulkForm({ ids, options, onDone }: { ids: string[]; options: BankingOptions; onDone: (failedIds: string[]) => void }) {
  const { run, pending, error } = useRunner({ inline: true });
  const [accountId, setAccountId] = useState("");
  const [fundId, setFundId] = useState("");
  const [programId, setProgramId] = useState("");
  return (
    <form
      className="space-y-4 text-sm"
      data-testid="bulk-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => bulkCategorizeAction({ txnIds: ids, accountId, fundId: fundId || null, programId: programId || null }),
          (r) => {
            onDone(r.failed.map((f) => f.txnId));
            return r.failed.length ? `Saved ${r.posted}. ${r.failed.length} could not be saved: ${r.failed[0].error}` : `Saved ${r.posted} transactions.`;
          }
        );
      }}
    >
      <Field label="Category">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} data-testid="bulk-category">
          <option value="">Choose…</option>
          <CategoryOptions categories={options.categories} deposit={false} />
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Fund">
          <FundSelect options={options} value={fundId} onChange={setFundId} />
        </Field>
        <Field label="Program">
          <ProgramSelect options={options} value={programId} onChange={setProgramId} />
        </Field>
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onDone(ids)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !accountId} data-testid="bulk-submit">
          {pending ? "Saving…" : "Save all"}
        </Button>
      </div>
    </form>
  );
}
