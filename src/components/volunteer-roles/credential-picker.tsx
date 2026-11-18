"use client";

import type { RoleCredentialOption } from "@/lib/dal/volunteer-roles";

/** Checkbox list of credential types; posts `requiredCredentialId` values. */
export function RoleCredentialPicker({
  options,
  defaultSelected = [],
}: {
  options: RoleCredentialOption[];
  defaultSelected?: string[];
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold text-stone-600">Required credentials (optional)</legend>
      <p className="mb-2 text-xs text-stone-400">Shown to volunteers when they sign up, and to you when you approve.</p>
      <div className="space-y-1.5">
        {options.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-alabaster/50 px-3.5 py-2.5"
          >
            <input
              type="checkbox"
              name="requiredCredentialId"
              value={o.id}
              defaultChecked={defaultSelected.includes(o.id)}
              className="h-4 w-4 accent-charcoal"
            />
            <span className="min-w-0 text-sm font-medium text-charcoal">
              {o.name}
              {o.archived ? <span className="ml-2 text-xs font-semibold text-stone-400">(archived)</span> : null}
            </span>
          </label>
        ))}
        {options.length === 0 ? <p className="text-xs text-stone-400">No credential types exist yet.</p> : null}
      </div>
    </fieldset>
  );
}
