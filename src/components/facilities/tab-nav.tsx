import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TabNav({ tabs, active, label }: { tabs: { id: string; label: ReactNode; href: string }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-1 flex flex-wrap gap-1.5 px-1">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === active ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
            t.id === active ? "bg-charcoal text-white" : "bg-white text-stone-600 border border-line hover:bg-stone-50"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
