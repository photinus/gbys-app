"use client";

import { ArrowDown, ArrowUp, PlayCircle, Plus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, EmptyState } from "@/components/ui";
import { applyRulesAction, moveRuleAction, setRuleActiveAction } from "@/app/(portal)/finance/banking/actions";
import type { BankingOptions } from "@/lib/dal/finance-banking";
import type { RuleListItem } from "@/lib/dal/finance-rules";
import { formatCents } from "@/lib/format";
import { emptyRule, RuleModal, type RuleDraft } from "./rule-modal";
import { useRunner } from "./use-runner";

const MATCH_WORDS = { contains: "contains", starts_with: "starts with", equals: "is exactly" } as const;
const DIR_WORDS = { any: "", deposit: " (money in)", withdrawal: " (money out)" } as const;

function toDraft(r: RuleListItem): RuleDraft {
  return {
    id: r.id, name: r.name, priority: r.priority, matchField: r.matchField as "description" | "payee", matchType: r.matchType,
    matchText: r.matchText, direction: r.direction, minAmountCents: r.minAmountCents, maxAmountCents: r.maxAmountCents,
    bankAccountId: r.bankAccountId, accountId: r.accountId, fundId: r.fundId, programId: r.programId, memo: r.memo,
    autoPost: r.autoPost, isActive: r.isActive,
  };
}

export function RulesList({ rules, options, canEdit }: { rules: RuleListItem[]; options: BankingOptions; canEdit: boolean }) {
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const { run, pending } = useRunner();
  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setDraft(emptyRule())} data-testid="new-rule">
            <Plus className="h-4 w-4" /> New rule
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || rules.length === 0}
            data-testid="apply-rules"
            onClick={() =>
              run(applyRulesAction, (r) => `Checked ${r.checked} new transactions: ${r.posted} posted by rules, ${r.suggested} suggested, ${r.matched} matched to existing entries.`)
            }
          >
            <PlayCircle className="h-4 w-4" /> Run rules on New transactions
          </Button>
        </div>
      ) : null}

      {rules.length === 0 ? (
        <EmptyState title="No rules yet" description="Rules save time on repeat transactions. You can also make one from any transaction in your inbox." />
      ) : (
        <ol className="space-y-3" data-testid="rule-list">
          {rules.map((r, i) => (
            <li key={r.id} className={r.isActive ? "rounded-2xl border border-line p-4" : "rounded-2xl border border-dashed border-line bg-alabaster/50 p-4 opacity-70"} data-testid="rule-item">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-charcoal">{r.name}</p>
                  <p className="mt-0.5 break-words text-xs text-stone-600">
                    If the {r.matchField} {MATCH_WORDS[r.matchType]} <strong>&ldquo;{r.matchText}&rdquo;</strong>
                    {DIR_WORDS[r.direction]}
                    {r.minAmountCents !== null || r.maxAmountCents !== null
                      ? `, amount ${r.minAmountCents !== null ? `from ${formatCents(r.minAmountCents)}` : ""}${r.maxAmountCents !== null ? ` up to ${formatCents(r.maxAmountCents)}` : ""}`
                      : ""}
                    {r.bankAccountName ? `, on ${r.bankAccountName}` : ""} → <strong>{r.accountLabel}</strong>
                    {r.programName ? ` · ${r.programName}` : ""}
                    {r.fundName ? ` · ${r.fundName}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Badge tone={r.autoPost ? "warning" : "neutral"}>{r.autoPost ? "Posts automatically" : "Suggests"}</Badge>
                  {!r.isActive ? <Badge>Off</Badge> : null}
                </div>
              </div>
              {canEdit ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setDraft(toDraft(r))} data-testid="edit-rule">
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setRuleActiveAction(r.id, !r.isActive), () => (r.isActive ? "Rule turned off." : "Rule turned on."))}>
                    {r.isActive ? "Turn off" : "Turn on"}
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Move earlier" disabled={pending || i === 0} onClick={() => run(() => moveRuleAction(r.id, "up"))}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Move later" disabled={pending || i === rules.length - 1} onClick={() => run(() => moveRuleAction(r.id, "down"))}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <RuleModal draft={draft} options={options} onClose={() => setDraft(null)} />
    </div>
  );
}
