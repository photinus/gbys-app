import Link from "next/link";
import { Badge, EmptyState, buttonStyles } from "@/components/ui";
import type { ContactFormRow } from "@/lib/dal/contact-forms";

/** Forms list. Rows are stacked cards on mobile and a grid from md up. `basePath` is the contact section root. */
export function FormsList({ forms, basePath, showProgram }: { forms: ContactFormRow[]; basePath: string; showProgram: boolean }) {
  if (forms.length === 0) {
    return (
      <EmptyState
        title="No contact forms yet"
        description="Create a form, then share its link or embed it on your website."
        action={
          <Link href={`${basePath}/forms/new`} className={buttonStyles({ size: "sm" })}>
            New form
          </Link>
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-line-soft" data-testid="forms-list">
      {forms.map((f) => (
        <li key={f.id} data-testid="form-row" className="grid gap-3 py-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto] md:items-center md:gap-4">
          <div className="min-w-0">
            <Link href={`${basePath}/forms/${f.id}`} className="block truncate font-semibold text-charcoal hover:underline">
              {f.title}
            </Link>
            <p className="truncate font-mono text-xs text-stone-400">/contact/{f.slug}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-stone-600">
            {showProgram ? <span className="truncate">{f.programName ?? "Org-wide"}</span> : null}
            <Badge tone={f.isActive ? "success" : "neutral"}>{f.isActive ? "Active" : "Inactive"}</Badge>
          </div>
          <div className="text-xs text-stone-500" data-testid="form-counts">
            <span className={f.newCount > 0 ? "font-semibold text-indigo-900" : ""}>{f.newCount} new</span> · {f.totalCount} total
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Link href={`${basePath}/forms/${f.id}`} className={buttonStyles({ size: "sm", variant: "secondary" })}>
              Edit
            </Link>
            <Link href={`${basePath}/forms/${f.id}#embed`} className={buttonStyles({ size: "sm", variant: "ghost" })}>
              Get embed code
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
