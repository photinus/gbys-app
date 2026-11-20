"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { saveBudgetAction } from "@/app/(portal)/finance/budgets/actions";
import { money, parseMoney } from "@/components/finance/gl/format";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { MONTH_COUNT, spreadEvenly } from "@/lib/finance/budget-math";
import { cn } from "@/lib/utils";

export interface GridLineInput {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: "revenue" | "expense";
  programId: string | null;
  programName: string | null;
  monthlyCents: number[];
  note: string | null;
}

export interface GridEditorOptions {
  accounts: { id: string; code: string; name: string; type: "revenue" | "expense" }[];
  programs: { id: string; name: string }[];
}

interface Row {
  key: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  type: "revenue" | "expense";
  programId: string;
  programName: string | null;
  months: string[];
  /** Typed annual amount waiting for "Spread"; null = show the sum of the months. */
  annualDraft: string | null;
  note: string;
}

const cellText = (cents: number) => (cents === 0 ? "" : (cents / 100).toFixed(2));
const cents = (s: string) => parseMoney(s);

let seq = 0;
function toRow(l: GridLineInput): Row {
  seq += 1;
  return {
    key: `b${seq}`,
    accountId: l.accountId,
    accountCode: l.accountCode,
    accountName: l.accountName,
    type: l.accountType,
    programId: l.programId ?? "",
    programName: l.programName,
    months: l.monthlyCents.map(cellText),
    annualDraft: null,
    note: l.note ?? "",
  };
}

function rowCents(r: Row): number[] {
  return r.months.map((m) => cents(m) ?? 0);
}

const sum = (xs: number[]) => xs.reduce((s, n) => s + n, 0);

/**
 * 12-month budget grid. Editable for drafts (`options` given), read-only otherwise. The grid scrolls
 * inside its own wrapper (the first column stays put) so the page never scrolls sideways on a phone.
 */
export function BudgetGrid({
  budgetId,
  name,
  notes,
  monthLabels,
  lines,
  options,
  readOnlyReason,
}: {
  budgetId: string;
  name: string;
  notes: string | null;
  monthLabels: string[];
  lines: GridLineInput[];
  /** Present only when the viewer can edit this draft. */
  options?: GridEditorOptions;
  readOnlyReason?: string;
}) {
  const editable = !!options;
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(saveBudgetAction);
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));
  const [title, setTitle] = useState(name);
  const [memo, setMemo] = useState(notes ?? "");
  const [addAccount, setAddAccount] = useState("");
  const [addProgram, setAddProgram] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [saved, setSaved] = useState(() => JSON.stringify({ n: name, m: notes ?? "", l: lines.map(toRow).map(snapshot) }));

  function snapshot(r: Row) {
    return { a: r.accountId, p: r.programId, m: rowCents(r), n: r.note };
  }
  const current = useMemo(() => JSON.stringify({ n: title, m: memo, l: rows.map(snapshot) }), [title, memo, rows]);
  const dirty = current !== saved;

  useEffect(() => {
    if (state?.ok) {
      toast.success("Budget saved");
      setSaved(current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const invalid = rows.some((r) => r.months.some((m) => m.trim() !== "" && cents(m) === null));
  const payload = JSON.stringify(
    rows.map((r) => ({ accountId: r.accountId, programId: r.programId || null, monthlyCents: rowCents(r), note: r.note }))
  );

  const totals = useMemo(() => {
    const rev = new Array<number>(MONTH_COUNT).fill(0);
    const exp = new Array<number>(MONTH_COUNT).fill(0);
    for (const r of rows) {
      const c = rowCents(r);
      const target = r.type === "revenue" ? rev : exp;
      c.forEach((v, i) => (target[i] += v));
    }
    return { rev, exp, net: rev.map((v, i) => v - exp[i]) };
  }, [rows]);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const setMonth = (key: string, i: number, value: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, months: r.months.map((m, j) => (j === i ? value : m)), annualDraft: null } : r)));
  const spread = (r: Row) => {
    const annual = cents(r.annualDraft ?? (sum(rowCents(r)) / 100).toFixed(2));
    if (annual === null || annual < 0) return;
    update(r.key, { months: spreadEvenly(annual).map(cellText), annualDraft: null });
  };

  const addRow = () => {
    setAddError(null);
    const acct = options?.accounts.find((a) => a.id === addAccount);
    if (!acct) return setAddError("Choose an account to add.");
    if (rows.some((r) => r.accountId === acct.id && r.programId === addProgram)) {
      return setAddError("That account is already in the budget for that program.");
    }
    seq += 1;
    const prog = options?.programs.find((p) => p.id === addProgram);
    setRows((rs) => [
      ...rs,
      {
        key: `b${seq}`,
        accountId: acct.id,
        accountCode: acct.code,
        accountName: acct.name,
        type: acct.type,
        programId: addProgram,
        programName: prog?.name ?? null,
        months: new Array(MONTH_COUNT).fill(""),
        annualDraft: null,
        note: "",
      },
    ]);
    setAddAccount("");
  };

  const sections: { type: "revenue" | "expense"; label: string }[] = [
    { type: "revenue", label: "Revenue (money in)" },
    { type: "expense", label: "Expenses (money out)" },
  ];
  const sortRows = (list: Row[]) =>
    [...list].sort((a, b) => a.accountCode.localeCompare(b.accountCode) || (a.programName ?? "").localeCompare(b.programName ?? ""));
  const revAnnual = sum(totals.rev);
  const expAnnual = sum(totals.exp);

  const body = (
    <>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="budget-summary">
        <Summary label="Planned revenue" cents={revAnnual} />
        <Summary label="Planned expenses" cents={expAnnual} />
        <Summary label="Planned surplus (revenue minus expenses)" cents={revAnnual - expAnnual} strong />
      </div>

      {readOnlyReason ? <p className="rounded-2xl bg-alabaster px-4 py-3 text-xs text-stone-600">{readOnlyReason}</p> : null}
      <p className="text-xs text-stone-500 sm:hidden">Swipe the table sideways to see every month.</p>

      <div className="overflow-x-auto rounded-2xl border border-line" data-testid="budget-grid-scroll">
        <table className="w-full min-w-[1280px] border-collapse text-sm" data-testid="budget-grid">
          <thead>
            <tr className="bg-alabaster text-[11px] uppercase tracking-wider text-stone-500">
              <th className="sticky left-0 z-10 min-w-[210px] bg-alabaster px-3 py-2.5 text-left font-semibold">Account / program</th>
              {monthLabels.map((m) => (
                <th key={m} className="min-w-[92px] px-1.5 py-2.5 text-right font-semibold whitespace-nowrap">
                  {m}
                </th>
              ))}
              <th className="min-w-[150px] px-2 py-2.5 text-right font-semibold">Year total</th>
              {editable ? <th className="w-10" /> : null}
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => {
              const list = sortRows(rows.filter((r) => r.type === s.type));
              return (
                <SectionRows
                  key={s.type}
                  label={s.label}
                  rows={list}
                  editable={editable}
                  colSpan={MONTH_COUNT + 2 + (editable ? 1 : 0)}
                  onMonth={setMonth}
                  onAnnual={(r, v) => update(r.key, { annualDraft: v })}
                  onSpread={spread}
                  onRemove={(r) => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                />
              );
            })}
          </tbody>
          <tfoot>
            <TotalRow label="Total revenue" values={totals.rev} testId="total-revenue" editable={editable} />
            <TotalRow label="Total expenses" values={totals.exp} testId="total-expense" editable={editable} />
            <TotalRow label="Net (revenue minus expenses)" values={totals.net} testId="total-net" strong editable={editable} />
          </tfoot>
        </table>
      </div>
    </>
  );

  if (!editable) {
    return <div className="space-y-4">{body}</div>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 text-sm" data-testid="budget-editor">
      <input type="hidden" name="id" value={budgetId} />
      <input type="hidden" name="lines" value={payload} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Budget name">
          <Input name="name" required minLength={2} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <Textarea name="notes" rows={1} maxLength={1000} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
      </div>

      {body}

      <div className="rounded-2xl border border-dashed border-line bg-alabaster/50 p-4">
        <p className="mb-3 text-xs font-semibold text-stone-600">Add a row</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="min-w-0">
            <label htmlFor="add-account" className="mb-1 block text-xs font-semibold text-stone-600">
              Account
            </label>
            <Select id="add-account" value={addAccount} onChange={(e) => setAddAccount(e.target.value)} data-testid="add-account">
              <option value="">Choose an account…</option>
              <optgroup label="Revenue (money in)">
                {options.accounts
                  .filter((a) => a.type === "revenue")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Expenses (money out)">
                {options.accounts
                  .filter((a) => a.type === "expense")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
              </optgroup>
            </Select>
          </div>
          <div className="min-w-0">
            <label htmlFor="add-program" className="mb-1 block text-xs font-semibold text-stone-600">
              Program
            </label>
            <Select id="add-program" value={addProgram} onChange={(e) => setAddProgram(e.target.value)} data-testid="add-program">
              <option value="">Whole organization</option>
              {options.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" onClick={addRow} data-testid="add-row">
            <Plus className="h-4 w-4" /> Add row
          </Button>
        </div>
        {addError ? (
          <p role="alert" className="mt-2 text-xs font-medium text-rose-700">
            {addError}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-stone-500">
          Type the monthly amounts, or type a yearly amount in the “Year total” box and press <strong>Spread</strong> to split it evenly (any leftover cents go in the last month).
        </p>
      </div>

      <FormError state={state} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className={cn("text-xs", dirty ? "font-semibold text-amber-800" : "text-stone-400")} data-testid="dirty-state">
          {dirty ? "You have unsaved changes" : "All changes saved"}
        </span>
        {invalid ? <span className="text-xs font-medium text-rose-700">Fix the amounts shown in red first.</span> : null}
        <Button type="submit" disabled={pending || invalid || !dirty} data-testid="save-budget">
          {pending ? "Saving..." : "Save budget"}
        </Button>
      </div>
    </form>
  );
}

function Summary({ label, cents: c, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="rounded-2xl bg-alabaster px-4 py-3">
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className={cn("tabular-nums text-charcoal", strong ? "text-xl font-bold" : "text-lg font-semibold", c < 0 && "text-rose-700")}>{money(c)}</p>
    </div>
  );
}

function SectionRows({
  label,
  rows,
  editable,
  colSpan,
  onMonth,
  onAnnual,
  onSpread,
  onRemove,
}: {
  label: string;
  rows: Row[];
  editable: boolean;
  colSpan: number;
  onMonth: (key: string, i: number, v: string) => void;
  onAnnual: (r: Row, v: string) => void;
  onSpread: (r: Row) => void;
  onRemove: (r: Row) => void;
}) {
  return (
    <>
      <tr className="bg-stone-100/80">
        <th scope="colgroup" className="sticky left-0 z-10 bg-stone-100 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider whitespace-nowrap text-stone-600">
          {label}
        </th>
        <td colSpan={colSpan - 1} />
      </tr>
      {rows.length === 0 ? (
        <tr>
          <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-3 text-left text-xs font-normal text-stone-400">
            Nothing here yet.
          </th>
          <td colSpan={colSpan - 1} />
        </tr>
      ) : null}
      {rows.map((r) => {
        const c = rowCents(r);
        const total = sum(c);
        return (
          <tr key={r.key} className="border-t border-line-soft" data-testid="budget-row" data-account={r.accountCode}>
            <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-normal">
              <span className="block max-w-[200px] truncate font-semibold text-charcoal" title={`${r.accountCode} ${r.accountName}`}>
                <span className="text-stone-400">{r.accountCode}</span> {r.accountName}
              </span>
              <span className="block text-xs text-stone-500">{r.programName ?? "Whole organization"}</span>
            </th>
            {r.months.map((m, i) => {
              const bad = m.trim() !== "" && cents(m) === null;
              return (
                <td key={i} className="px-1 py-1.5">
                  {editable ? (
                    <Input
                      inputMode="decimal"
                      value={m}
                      placeholder="0"
                      aria-label={`${r.accountName}${r.programName ? ` (${r.programName})` : ""}, month ${i + 1}`}
                      aria-invalid={bad}
                      onChange={(e) => onMonth(r.key, i, e.target.value)}
                      className="px-2 py-1.5 text-right tabular-nums"
                    />
                  ) : (
                    <span className="block px-2 text-right tabular-nums">{c[i] ? money(c[i]) : <span className="text-stone-300">–</span>}</span>
                  )}
                </td>
              );
            })}
            <td className="px-2 py-1.5">
              {editable ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    inputMode="decimal"
                    value={r.annualDraft ?? (total === 0 ? "" : (total / 100).toFixed(2))}
                    placeholder="0"
                    aria-label={`Year total for ${r.accountName}${r.programName ? ` (${r.programName})` : ""}`}
                    onChange={(e) => onAnnual(r, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onSpread(r);
                      }
                    }}
                    className="min-w-[84px] px-2 py-1.5 text-right font-semibold tabular-nums"
                    data-testid="annual-input"
                  />
                  <Button variant="secondary" size="sm" onClick={() => onSpread(r)} className="px-2.5" data-testid="spread">
                    Spread
                  </Button>
                </div>
              ) : (
                <span className="block text-right font-semibold tabular-nums" data-testid="row-total">
                  {money(total)}
                </span>
              )}
            </td>
            {editable ? (
              <td className="px-1">
                <button
                  type="button"
                  onClick={() => onRemove(r)}
                  aria-label={`Remove ${r.accountName} row`}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-alabaster hover:text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            ) : null}
          </tr>
        );
      })}
    </>
  );
}

function TotalRow({ label, values, testId, strong, editable }: { label: string; values: number[]; testId: string; strong?: boolean; editable: boolean }) {
  return (
    <tr className={cn("border-t border-stone-300 bg-alabaster/70", strong && "border-t-2 font-bold")} data-testid={testId}>
      <th scope="row" className="sticky left-0 z-10 bg-alabaster px-3 py-2.5 text-left font-semibold">
        {label}
      </th>
      {values.map((v, i) => (
        <td key={i} className={cn("px-3 py-2.5 text-right tabular-nums whitespace-nowrap", v < 0 && "text-rose-700")}>
          {money(v)}
        </td>
      ))}
      <td className={cn("px-3 py-2.5 text-right font-bold tabular-nums whitespace-nowrap", sum(values) < 0 && "text-rose-700")} data-testid={`${testId}-annual`}>
        {money(sum(values))}
      </td>
      {editable ? <td /> : null}
    </tr>
  );
}
