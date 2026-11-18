"use client";

import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

export function ProgramFilter({
  options,
  value,
}: {
  options: { id: string; name: string }[];
  value: string;
}) {
  const router = useRouter();
  return (
    <div className="w-full sm:max-w-xs">
      <Field label="Show roles for">
        <Select
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            router.replace(v === "all" ? "/volunteer/roles#find" : `/volunteer/roles?program=${v}#find`, { scroll: false });
          }}
        >
          <option value="all">All programs</option>
          <option value="org">Organization-wide</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
