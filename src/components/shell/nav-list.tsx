"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActivePath, type NavGroup } from "./nav";
import { NAV_ICONS } from "./nav-icons";

/**
 * Grouped nav links. Expanded: group titles + icon/label rows. Collapsed: icon rail with
 * dividers between groups; each link keeps an accessible name and a tooltip.
 */
export function NavList({
  groups,
  collapsed = false,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed?: boolean;
  /** Called when a link is clicked (the mobile drawer uses it to close). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));

  return (
    <nav aria-label="Primary" className={cn("flex flex-col", collapsed ? "items-center" : "")}>
      {groups.map((group, gi) => (
        <div
          key={group.id}
          role="group"
          aria-labelledby={`nav-group-${group.id}`}
          className={cn(collapsed ? "flex flex-col items-center gap-1.5" : "", gi > 0 && !collapsed && "mt-5")}
        >
          {collapsed ? (
            <>
              {gi > 0 ? <div aria-hidden className="my-2.5 h-px w-8 bg-line" /> : null}
              <h2 id={`nav-group-${group.id}`} className="sr-only">
                {group.title}
              </h2>
            </>
          ) : (
            <h2
              id={`nav-group-${group.id}`}
              className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400"
            >
              {group.title}
            </h2>
          )}
          <ul className={cn(collapsed ? "flex flex-col items-center gap-1.5" : "flex flex-col gap-0.5")}>
            {group.items.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = isActivePath(pathname, item.href, allHrefs);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center rounded-full text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80",
                      collapsed ? "h-11 w-11 justify-center" : "h-11 gap-3 px-3.5 whitespace-nowrap",
                      active
                        ? "bg-periwinkle/35 text-charcoal font-semibold"
                        : "text-stone-500 font-medium hover:bg-stone-200/70 hover:text-charcoal",
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.9} aria-hidden />
                    {collapsed ? null : <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
