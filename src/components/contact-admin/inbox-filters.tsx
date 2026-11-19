import { Input, Select, buttonStyles } from "@/components/ui";
import { STATUS_FILTERS, STATUS_FILTER_LABELS, type InboxFilters } from "@/lib/validation/contact-forms";
import Link from "next/link";

/** GET filter form (form, status, search). Server-rendered; the page reads the query string. */
export function InboxFilterForm({
  basePath,
  forms,
  filters,
}: {
  basePath: string;
  forms: { id: string; title: string }[];
  filters: InboxFilters;
}) {
  const active = !!(filters.formId || filters.q || (filters.status && filters.status !== "open"));
  return (
    <form method="get" action={basePath} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr_auto] lg:items-end" data-testid="inbox-filters">
      <div className="min-w-0">
        <label htmlFor="f-form" className="mb-1.5 block text-xs font-semibold text-stone-500">
          Form
        </label>
        <Select id="f-form" name="form" defaultValue={filters.formId ?? ""}>
          <option value="">All forms</option>
          {forms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.title}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-0">
        <label htmlFor="f-status" className="mb-1.5 block text-xs font-semibold text-stone-500">
          Status
        </label>
        <Select id="f-status" name="status" defaultValue={filters.status ?? "open"}>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {STATUS_FILTER_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-0 sm:col-span-2 lg:col-span-1">
        <label htmlFor="f-q" className="mb-1.5 block text-xs font-semibold text-stone-500">
          Search name or email
        </label>
        <Input id="f-q" name="q" type="search" maxLength={100} defaultValue={filters.q ?? ""} placeholder="Search" />
      </div>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
        <button type="submit" className={buttonStyles({ variant: "secondary" })}>
          Apply
        </button>
        {active ? (
          <Link href={basePath} className={buttonStyles({ variant: "ghost" })}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
