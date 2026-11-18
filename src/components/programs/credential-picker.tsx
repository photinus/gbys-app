"use client";

import type { CredentialOption } from "@/lib/dal/programs";

/** Multi-select of credential definitions (checkbox list, posts `requiredCredentialId` values). */
export function CredentialPicker({
  options,
  defaultSelected = [],
}: {
  options: CredentialOption[];
  defaultSelected?: string[];
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-semibold text-stone-600">Required credentials for coaches</legend>
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
            <span className="text-sm font-medium text-charcoal">{o.name}</span>
          </label>
        ))}
        {options.length === 0 ? <p className="text-xs text-stone-400">No credential definitions exist yet.</p> : null}
      </div>
    </fieldset>
  );
}
