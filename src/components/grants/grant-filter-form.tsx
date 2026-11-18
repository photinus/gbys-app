"use client";

import { Button, buttonStyles } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { GrantFilters } from "@/lib/validation/grants";
import { CATEGORY_LABELS, VERIFICATION_LABELS, VOLUNTEER_CATEGORIES } from "@/lib/volunteer-categories";

export function GrantFilterForm({
  filters,
  programs,
}: {
  filters: GrantFilters;
  programs: { id: string; name: string }[];
}) {
  const knownProgram = filters.program === "all" || filters.program === "org" || programs.some((p) => p.id === filters.program);
  return (
    <form method="get" action="/admin/grants" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From" hint="Inclusive (Pacific time)">
          <Input type="date" name="from" defaultValue={filters.from} required />
        </Field>
        <Field label="To" hint="Inclusive (Pacific time)">
          <Input type="date" name="to" defaultValue={filters.to} required />
        </Field>
        <Field label="Program">
          <Select name="program" defaultValue={filters.program}>
            <option value="all">All programs and org-wide</option>
            <option value="org">Org-wide only (no program)</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {!knownProgram ? <option value={filters.program}>Inactive program</option> : null}
          </Select>
        </Field>
        <Field label="Verification">
          <Select name="verification" defaultValue={filters.verification}>
            <option value="verified">Verified only (check-in + admin approved)</option>
            <option value="all">All entries (including pending)</option>
            <option value="shift_checkin">{VERIFICATION_LABELS.shift_checkin} only</option>
            <option value="admin_approved">{VERIFICATION_LABELS.admin_approved} only</option>
            <option value="self_reported">{VERIFICATION_LABELS.self_reported} only</option>
          </Select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-stone-600">Categories (none selected = all)</legend>
        <div className="flex flex-wrap gap-2">
          {VOLUNTEER_CATEGORIES.map((c) => (
            <label
              key={c}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-alabaster px-3.5 py-1.5 text-sm text-charcoal has-[:checked]:border-charcoal has-[:checked]:bg-white has-[:checked]:font-semibold"
            >
              <input
                type="checkbox"
                name="categories"
                value={c}
                defaultChecked={filters.categories.includes(c)}
                className="h-4 w-4 accent-charcoal"
              />
              {CATEGORY_LABELS[c]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Button type="submit">Apply filters</Button>
        <a href="/admin/grants" className={buttonStyles({ variant: "ghost" })}>
          Reset
        </a>
      </div>
    </form>
  );
}
