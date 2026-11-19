import Link from "next/link";
import { cn } from "@/lib/utils";

export type TeamTabId = "overview" | "schedule" | "emergency";

/** Overview / Schedule / Emergency tab bar shared by the team pages. */
export function TeamTabs({ slug, teamId, active }: { slug: string; teamId: string; active: TeamTabId }) {
  const base = `/programs/${slug}/teams/${teamId}`;
  const tabs: { id: TeamTabId; label: string; href: string }[] = [
    { id: "overview", label: "Overview", href: base },
    { id: "schedule", label: "Schedule", href: `${base}/schedule` },
    { id: "emergency", label: "Emergency", href: `${base}/emergency` },
  ];
  return (
    <nav aria-label="Team sections" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? "page" : undefined}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
            active === t.id ? "border-charcoal text-charcoal" : "border-transparent text-stone-500 hover:text-charcoal"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
