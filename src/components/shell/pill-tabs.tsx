"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActivePath } from "./nav";

export interface PillTab {
  label: string;
  href: string;
}

export function PillTabs({
  items,
  activeHref,
  className,
}: {
  items: PillTab[];
  /** Override active detection (defaults to matching the current pathname). */
  activeHref?: string;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className={cn("flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 sm:pb-0", className)}
    >
      {items.map((item) => {
        const active = activeHref ? activeHref === item.href : isActivePath(pathname, item.href, items.map((i) => i.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full text-sm whitespace-nowrap transition-all",
              active
                ? "px-5 py-2.5 font-semibold bg-charcoal text-white shadow-sm"
                : "px-4 py-2.5 font-medium text-stone-600 hover:text-charcoal hover:bg-white/70",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
