import Link from "next/link";
import { cn } from "@/lib/utils";

/** Inbox | Forms switcher shared by the admin and program-scoped contact pages. */
export function ContactTabs({ basePath, active, newCount }: { basePath: string; active: "inbox" | "forms"; newCount?: number }) {
  const tabs = [
    { key: "inbox", label: "Inbox", href: basePath },
    { key: "forms", label: "Forms", href: `${basePath}/forms` },
  ] as const;
  return (
    <nav aria-label="Contact sections" className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-white p-1 text-sm font-semibold shadow-sm">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cn("whitespace-nowrap rounded-full px-4 py-2", active === t.key ? "bg-charcoal text-white" : "text-stone-600 hover:bg-alabaster")}
        >
          {t.label}
          {t.key === "inbox" && newCount ? (
            <span data-testid="new-count" className={cn("ml-2 rounded-full px-2 py-0.5 text-xs", active === "inbox" ? "bg-white/20" : "bg-periwinkle/35 text-indigo-950")}>
              {newCount} new
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
