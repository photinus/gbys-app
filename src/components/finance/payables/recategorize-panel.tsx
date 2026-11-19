"use client";

import { useState } from "react";
import { recategorizeBillAction } from "@/app/(portal)/finance/payables/actions";
import { money } from "@/components/finance/gl/format";
import { useRunner } from "@/components/finance/banking/use-runner";
import { Button, Input, Label, Select } from "@/components/ui";
import type { BillLineRow, BillOptions } from "@/lib/dal/finance-bills";

/**
 * Reviewers fix categories on a pending bill or reimbursement without sending it back.
 * Amounts are read-only here; changing an amount means sending it back.
 */
export function RecategorizePanel({ billId, lines, options }: { billId: string; lines: BillLineRow[]; options: BillOptions }) {
  const { run, pending, error } = useRunner({ inline: true });
  const [rows, setRows] = useState(() =>
    lines.map((l) => ({ accountId: l.accountId, fundId: l.fundId ?? options.generalFundId, programId: l.programId ?? "", description: l.description ?? "" }))
  );
  const [saved, setSaved] = useState(false);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => {
    setSaved(false);
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const accountGroups = [
    { label: "Expenses", accounts: options.accounts.filter((a) => a.type === "expense") },
    { label: "Equipment, prepaid & other assets", accounts: options.accounts.filter((a) => a.type === "asset") },
  ].filter((g) => g.accounts.length > 0);

  return (
    <div className="space-y-3" data-testid="recategorize">
      <p className="text-sm text-stone-600">Check that each line is in the right category before approving. Changing a category doesn&apos;t restart the approval.</p>
      <ul className="space-y-3">
        {lines.map((l, i) => (
          <li key={l.id} className="rounded-2xl border border-line p-3.5">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">{l.description || `Line ${i + 1}`}</p>
              <p className="shrink-0 text-sm font-bold tabular-nums">{money(l.amountCents)}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="min-w-0">
                <Label htmlFor={`rc-a-${i}`}>Category</Label>
                <Select id={`rc-a-${i}`} value={rows[i].accountId} onChange={(e) => set(i, { accountId: e.target.value })} aria-label={`Category for line ${i + 1}`}>
                  {accountGroups.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <div className="min-w-0">
                <Label htmlFor={`rc-f-${i}`}>Fund</Label>
                <Select id={`rc-f-${i}`} value={rows[i].fundId} onChange={(e) => set(i, { fundId: e.target.value })} aria-label={`Fund for line ${i + 1}`}>
                  {options.funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-0">
                <Label htmlFor={`rc-p-${i}`}>Program</Label>
                <Select id={`rc-p-${i}`} value={rows[i].programId} onChange={(e) => set(i, { programId: e.target.value })} aria-label={`Program for line ${i + 1}`}>
                  <option value="">Whole organization</option>
                  {options.programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-0 sm:col-span-3">
                <Input value={rows[i].description} maxLength={500} placeholder="Note (optional)" aria-label={`Note for line ${i + 1}`} onChange={(e) => set(i, { description: e.target.value })} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={pending}
          data-testid="save-categories"
          onClick={() =>
            run(
              () =>
                recategorizeBillAction(
                  billId,
                  lines.map((l, i) => ({
                    accountId: rows[i].accountId,
                    fundId: rows[i].fundId === options.generalFundId ? "" : rows[i].fundId,
                    programId: rows[i].programId,
                    amountCents: l.amountCents,
                    description: rows[i].description,
                  }))
                ),
              () => {
                setSaved(true);
                return "Categories saved";
              }
            )
          }
        >
          {pending ? "Saving..." : "Save categories"}
        </Button>
        {saved ? <span className="text-xs font-semibold text-emerald-800">Saved</span> : null}
      </div>
    </div>
  );
}
