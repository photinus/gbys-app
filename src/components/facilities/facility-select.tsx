import type { SelectHTMLAttributes } from "react";
import { Select } from "@/components/ui";
import type { FacilityNode } from "@/lib/validation/facilities";

/** Facility picker; children are indented under their parent. `flat` is depth-first. */
export function FacilitySelect({
  flat,
  placeholder,
  excludeIds,
  ...props
}: { flat: FacilityNode[]; placeholder?: string; excludeIds?: Set<string> } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Select {...props}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {flat
        .filter((f) => !excludeIds?.has(f.id))
        .map((f) => (
          <option key={f.id} value={f.id}>
            {"  ".repeat(f.depth)}
            {f.depth ? "└ " : ""}
            {f.name}
          </option>
        ))}
    </Select>
  );
}
