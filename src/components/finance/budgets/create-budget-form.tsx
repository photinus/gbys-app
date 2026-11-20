"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createBudgetAction } from "@/app/(portal)/finance/budgets/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import type { CreateBudgetFormData } from "@/lib/dal/finance-budgets";

const SOURCES = [
  { value: "blank", title: "Start blank", hint: "An empty budget. Add the accounts you want to plan for." },
  { value: "actuals", title: "Start from last year's actuals", hint: "Fills each month with what was actually earned and spent in the previous fiscal year, rounded to whole dollars." },
  { value: "copy", title: "Copy another budget", hint: "Duplicates the amounts of an existing budget so you can adjust them." },
];

export function CreateBudgetForm({ data, defaultFiscalYear }: { data: CreateBudgetFormData; defaultFiscalYear: string }) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(createBudgetAction);
  const [source, setSource] = useState("blank");
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.data.lineCount ? `Budget created with ${state.data.lineCount} lines` : "Budget created");
      router.push(`/finance/budgets/${state.data.id}`);
    }
  }, [state, toast, router]);
  return (
    <form onSubmit={onSubmit} className="space-y-5 text-sm" data-testid="create-budget-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Budget name" hint="e.g. “FY2027 operating budget”.">
          <Input name="name" required minLength={2} maxLength={120} data-testid="budget-name" />
        </Field>
        <Field label="Fiscal year">
          <Select name="fiscalYearDate" defaultValue={defaultFiscalYear} data-testid="budget-fy">
            {data.fiscalYears.map((f) => (
              <option key={f.start} value={f.start}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-semibold text-stone-600">How do you want to begin?</legend>
        {SOURCES.map((s) => (
          <label key={s.value} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-3.5 has-[:checked]:border-charcoal has-[:checked]:bg-alabaster">
            <input
              type="radio"
              name="source"
              value={s.value}
              checked={source === s.value}
              onChange={() => setSource(s.value)}
              className="mt-1 h-4 w-4 accent-charcoal"
              data-testid={`budget-source-${s.value}`}
            />
            <span>
              <span className="block font-semibold text-charcoal">{s.title}</span>
              <span className="block text-xs text-stone-500">{s.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {source === "copy" ? (
        <Field label="Budget to copy">
          <Select name="copyFromBudgetId" required defaultValue="">
            <option value="">Choose a budget…</option>
            {data.budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.fyLabel})
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Notes (optional)">
        <Textarea name="notes" rows={2} maxLength={1000} />
      </Field>
      <FormError state={state} />
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} data-testid="create-budget">
          {pending ? "Creating..." : "Create budget"}
        </Button>
      </div>
    </form>
  );
}
