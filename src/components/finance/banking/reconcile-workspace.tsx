"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, EmptyState, useToast } from "@/components/ui";
import { completeReconciliationAction, discardReconciliationAction, setClearedAction } from "@/app/(portal)/finance/banking/actions";
import type { ReconciliationDetail } from "@/lib/dal/finance-reconcile";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { dateOnly, SOURCE_LABELS } from "./shared";
import { useRunner } from "./use-runner";

function Stat({ label, value, tone, testId }: { label: string; value: string; tone?: "good" | "bad"; testId: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-white p-3.5" data-testid={testId}>
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tracking-tight tabular-nums", tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-charcoal")}>{value}</div>
    </div>
  );
}

export function ReconcileWorkspace({ detail, canEdit }: { detail: ReconciliationDetail; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [, startToggle] = useTransition();
  const { run, pending } = useRunner();
  const completed = detail.status === "completed";
  const [cleared, setCleared] = useState<Set<string>>(() => new Set(detail.lines.filter((l) => l.cleared).map((l) => l.lineId)));
  const liability = detail.accountType === "liability";

  const clearedTotal = detail.lines.reduce((s, l) => s + (cleared.has(l.lineId) ? l.amountCents : 0), 0);
  const clearedBalance = detail.beginningBalanceCents + clearedTotal;
  const diff = detail.statementEndingBalanceCents - clearedBalance;
  const clearedCount = cleared.size;

  function setMany(ids: string[], value: boolean) {
    const prev = cleared;
    const next = new Set(prev);
    for (const id of ids) (value ? next.add(id) : next.delete(id));
    setCleared(next);
    startToggle(async () => {
      const r = await setClearedAction({ reconciliationId: detail.id, lineIds: ids, cleared: value });
      if (!r.ok) {
        setCleared(prev);
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat testId="rec-ending" label="Statement ending balance" value={formatCents(detail.statementEndingBalanceCents)} />
        <Stat testId="rec-beginning" label="Beginning balance" value={formatCents(detail.beginningBalanceCents)} />
        <Stat testId="rec-cleared" label={`Cleared (${clearedCount})`} value={formatCents(clearedBalance)} />
        <Stat testId="rec-diff" label="Difference" value={formatCents(diff)} tone={diff === 0 ? "good" : "bad"} />
      </div>

      {completed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sage/30 p-4 text-sm text-emerald-950" data-testid="rec-completed">
          <p>
            Reconciled on {detail.completedAt ? formatDateTime(detail.completedAt) : ""}
            {detail.completedByName ? ` by ${detail.completedByName}` : ""}. Matched your statement dated {formatDate(dateOnly(detail.statementEndDate))}.
          </p>
          <Button size="sm" variant="secondary" className="print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      ) : canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => setMany(detail.lines.filter((l) => !cleared.has(l.lineId)).map((l) => l.lineId), true)} data-testid="rec-select-all">
            Mark all cleared
          </Button>
          <Button size="sm" variant="ghost" disabled={pending || clearedCount === 0} onClick={() => setMany([...cleared], false)}>
            Clear all
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            data-testid="rec-discard"
            onClick={() => {
              if (window.confirm("Discard this reconciliation? Your checkmarks are lost. Nothing in your books changes.")) {
                run(
                  () => discardReconciliationAction({ reconciliationId: detail.id }),
                  () => {
                    router.push("/finance/banking/reconcile");
                    return "Reconciliation discarded.";
                  }
                );
              }
            }}
          >
            Discard
          </Button>
          <Button
            size="sm"
            disabled={pending || diff !== 0}
            data-testid="rec-complete"
            onClick={() => run(() => completeReconciliationAction({ reconciliationId: detail.id }), (r) => `Reconciled. ${r.clearedCount} items cleared.`)}
          >
            Finish reconciling
          </Button>
        </div>
      ) : null}
      {!completed && diff !== 0 ? (
        <p className="text-xs text-stone-500" data-testid="rec-hint">
          Check off each item that appears on your statement. You can finish when the difference is $0.00.
        </p>
      ) : null}

      {detail.lines.length === 0 ? (
        <EmptyState title="Nothing to reconcile" description="There are no uncleared items up to the statement date." />
      ) : (
        <ul className="divide-y divide-line-soft rounded-2xl border border-line" data-testid="rec-lines">
          {detail.lines.map((l) => {
            const on = cleared.has(l.lineId);
            const increase = l.amountCents > 0;
            const goodTone = liability ? !increase : increase;
            return (
              <li key={l.lineId} className={cn("flex items-start gap-3 px-3.5 py-3", on && "bg-alabaster/60")} data-testid="rec-line">
                {completed || !canEdit ? (
                  on ? <Badge tone="success" className="mt-0.5 px-2 py-0.5 text-[11px]">Cleared</Badge> : null
                ) : (
                  <input
                    type="checkbox"
                    aria-label={`Cleared: ${l.memo}`}
                    className="mt-1 h-5 w-5 shrink-0 accent-charcoal"
                    checked={on}
                    disabled={pending}
                    onChange={() => setMany([l.lineId], !on)}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-charcoal">{l.memo}</p>
                  <p className="text-xs text-stone-500">
                    {formatDate(dateOnly(l.entryDate))} ·{" "}
                    <Link href={`/finance/journal/${l.entryId}`} className="underline-offset-2 hover:underline">
                      Entry #{l.entryNumber}
                    </Link>{" "}
                    · {SOURCE_LABELS[l.source] ?? l.source}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn("text-sm font-semibold tabular-nums", goodTone ? "text-emerald-700" : "text-rose-700")}>
                    {increase ? "+" : "-"}
                    {formatCents(Math.abs(l.amountCents))}
                  </div>
                  <div className="text-[11px] text-stone-400">{liability ? (increase ? "Charge" : "Payment") : increase ? "Money in" : "Money out"}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
