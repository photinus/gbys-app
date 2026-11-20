"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/finance/donations", label: "Gifts", exact: true, also: ["/finance/donations/new"] },
  { href: "/finance/donations/donors", label: "Donors" },
  { href: "/finance/donations/receipts", label: "Send receipts" },
  { href: "/finance/donations/statements", label: "Yearly statements" },
  { href: "/finance/donations/funds", label: "Funds" },
];

/** Sub-navigation for the donations area. Scrolls sideways inside itself on narrow screens. */
export function DonationsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Donation sections" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-1.5 border-b border-line-soft pb-3">
        {TABS.map((t) => {
          const active = t.exact
            ? path === t.href || (t.also ?? []).includes(path) || /^\/finance\/donations\/[0-9a-f-]{36}/i.test(path)
            : path === t.href || path.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                  active ? "bg-charcoal text-white" : "text-stone-600 hover:bg-alabaster hover:text-charcoal"
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
