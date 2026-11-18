"use client";

import { Button, buttonStyles } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { AuditFilters } from "@/lib/validation/audit-log";

export function AuditFilterForm({
  filters,
  actions,
  targetTypes,
}: {
  filters: AuditFilters;
  actions: string[];
  targetTypes: string[];
}) {
  // Keep a filtered-on value selectable even if no rows currently carry it.
  const actionList = filters.action && !actions.includes(filters.action) ? [filters.action, ...actions] : actions;
  const typeList =
    filters.targetType && !targetTypes.includes(filters.targetType) ? [filters.targetType, ...targetTypes] : targetTypes;
  return (
    <form method="get" action="/admin/audit" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Action">
          <Select name="action" defaultValue={filters.action ?? ""}>
            <option value="">All actions</option>
            {actionList.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Actor" hint='Name or email. Type "system" for automated runs'>
          <Input type="search" name="actor" maxLength={100} defaultValue={filters.actorQuery ?? ""} placeholder="e.g. Dana or dana@example.com" />
        </Field>
        <Field label="Target type">
          <Select name="targetType" defaultValue={filters.targetType ?? ""}>
            <option value="">All target types</option>
            {typeList.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" hint="Inclusive (Pacific time)">
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </Field>
        <Field label="To" hint="Inclusive (Pacific time)">
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </Field>
        <Field label="Target id" hint="Exact match (user id, program id, ...)">
          <Input type="text" name="targetId" maxLength={100} defaultValue={filters.targetId ?? ""} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Apply filters</Button>
        <a href="/admin/audit" className={buttonStyles({ variant: "ghost" })}>
          Reset
        </a>
      </div>
    </form>
  );
}
