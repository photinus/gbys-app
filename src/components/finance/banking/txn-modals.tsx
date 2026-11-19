"use client";

import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { excludeAction, matchAction, transferAction } from "@/app/(portal)/finance/banking/actions";
import type { BankingOptions, InboxRow } from "@/lib/dal/finance-banking";
import { EXCLUDE_REASONS, EXCLUDE_REASON_LABELS } from "@/lib/validation/finance-banking";
import { formatCents, formatDate } from "@/lib/format";
import { dateOnly, SOURCE_LABELS } from "./shared";
import { useRunner } from "./use-runner";

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
      {error}
    </p>
  );
}

export function TransferModal({ row, options, onClose }: { row: InboxRow | null; options: BankingOptions; onClose: () => void }) {
  return (
    <Modal open={!!row} onClose={onClose} title={row && row.amountCents > 0 ? "Transfer from another account" : "Transfer to another account"} description="Use this for money you moved between your own bank accounts. It isn't income or an expense.">
      {row ? <TransferForm key={row.id} row={row} options={options} onDone={onClose} /> : null}
    </Modal>
  );
}

function TransferForm({ row, options, onDone }: { row: InboxRow; options: BankingOptions; onDone: () => void }) {
  const { run, pending, error } = useRunner({ inline: true });
  const [to, setTo] = useState("");
  const deposit = row.amountCents > 0;
  const choices = options.bankAccounts.filter((b) => b.id !== row.glAccountId);
  return (
    <form
      className="space-y-4 text-sm"
      data-testid="transfer-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => transferAction({ txnId: row.id, toGlAccountId: to }),
          () => {
            onDone();
            return "Transfer recorded.";
          }
        );
      }}
    >
      <Field label={deposit ? "Money came from" : "Money went to"}>
        <Select value={to} onChange={(e) => setTo(e.target.value)} data-testid="transfer-select">
          <option value="">Choose an account…</option>
          {choices.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-stone-500">
        When the other account&apos;s bank feed shows the matching {deposit ? "withdrawal" : "deposit"}, it is linked to this transfer automatically.
      </p>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !to}>
          {pending ? "Saving…" : "Record transfer"}
        </Button>
      </div>
    </form>
  );
}

export function MatchModal({ row, onClose }: { row: InboxRow | null; onClose: () => void }) {
  return (
    <Modal open={!!row} onClose={onClose} title="Match to an existing entry" description="This transaction is already in your books. Link it instead of entering it twice.">
      {row ? <MatchForm key={row.id} row={row} onDone={onClose} /> : null}
    </Modal>
  );
}

function MatchForm({ row, onDone }: { row: InboxRow; onDone: () => void }) {
  const { run, pending, error } = useRunner({ inline: true });
  const [entryId, setEntryId] = useState(row.candidates.length === 1 ? row.candidates[0].entryId : "");
  return (
    <form
      className="space-y-4 text-sm"
      data-testid="match-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => matchAction({ txnId: row.id, entryId }),
          (r) => {
            onDone();
            return `Matched to journal entry #${r.entryNumber}.`;
          }
        );
      }}
    >
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-semibold text-stone-600">Entries for {formatCents(Math.abs(row.amountCents))} within 5 days</legend>
        {row.candidates.map((c) => (
          <label key={c.entryId} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-alabaster/50 px-3.5 py-2.5">
            <input type="radio" name="entry" value={c.entryId} checked={entryId === c.entryId} onChange={() => setEntryId(c.entryId)} className="mt-1 h-4 w-4 accent-charcoal" />
            <span className="min-w-0 text-sm">
              <span className="font-medium text-charcoal">
                #{c.entryNumber} · {formatDate(dateOnly(c.entryDate))}
              </span>
              <span className="block break-words text-xs text-stone-500">
                {SOURCE_LABELS[c.source] ?? c.source} · {c.memo}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !entryId}>
          {pending ? "Saving…" : "Match"}
        </Button>
      </div>
    </form>
  );
}

export function ExcludeModal({ row, onClose }: { row: InboxRow | null; onClose: () => void }) {
  return (
    <Modal open={!!row} onClose={onClose} title="Leave out of the books" description="Excluded transactions aren't posted. You can bring them back later.">
      {row ? <ExcludeForm key={row.id} row={row} onDone={onClose} /> : null}
    </Modal>
  );
}

function ExcludeForm({ row, onDone }: { row: InboxRow; onDone: () => void }) {
  const { run, pending, error } = useRunner({ inline: true });
  const [reason, setReason] = useState<string>("duplicate");
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-4 text-sm"
      data-testid="exclude-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => excludeAction({ txnId: row.id, reason, note: note || null }),
          () => {
            onDone();
            return "Moved to Excluded.";
          }
        );
      }}
    >
      <Field label="Why?">
        <Select value={reason} onChange={(e) => setReason(e.target.value)} data-testid="exclude-reason">
          {EXCLUDE_REASONS.map((r) => (
            <option key={r} value={r}>
              {EXCLUDE_REASON_LABELS[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} data-testid="exclude-submit">
          {pending ? "Saving…" : "Exclude"}
        </Button>
      </div>
    </form>
  );
}
