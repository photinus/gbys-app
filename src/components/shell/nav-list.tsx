"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { allNavHrefs, groupHasActive, isActivePath, type NavGroup, type NavItem } from "./nav";
import { GROUP_ICONS, NAV_ICONS } from "./nav-icons";
import { RailGroup } from "./nav-flyout";
import { useNavCollapse } from "./nav-collapse";

const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80";

function linkClasses(active: boolean, extra: string) {
  return cn(
    "flex items-center rounded-full text-sm transition-colors",
    RING,
    extra,
    active
      ? "bg-periwinkle/35 text-charcoal font-semibold"
      : "text-stone-500 font-medium hover:bg-stone-200/70 hover:text-charcoal",
  );
}

interface Env {
  pathname: string | null;
  allHrefs: string[];
  collapsed: boolean;
  roomy: boolean;
  prefix: string;
  onNavigate?: () => void;
}

function ItemLink({ item, env }: { item: NavItem; env: Env }) {
  const { pathname, allHrefs, collapsed, roomy, onNavigate } = env;
  const Icon = NAV_ICONS[item.icon];
  const active = isActivePath(pathname, item.href, allHrefs);
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={linkClasses(
        active,
        collapsed ? "h-11 w-11 justify-center" : cn(roomy ? "h-11" : "h-9", "gap-3 px-3.5 whitespace-nowrap"),
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.9} aria-hidden />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function Section({ group, env }: { group: NavGroup; env: Env }) {
  const { pathname, allHrefs, prefix } = env;
  const { isExpanded, toggle } = useNavCollapse();
  const hasActive = groupHasActive(group, pathname, allHrefs);
  const open = isExpanded(group.id, pathname, hasActive);
  const regionId = `${prefix}-${group.id}`;
  return (
    <>
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => toggle(group.id, pathname, hasActive)}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-full px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-400 transition-colors hover:bg-stone-200/50 hover:text-stone-600",
            RING,
          )}
        >
          <span className="min-w-0 flex-1 truncate">{group.title}</span>
          <span aria-hidden className="text-[11px] font-medium tabular-nums text-stone-400">
            {group.items.length}
          </span>
          <span className="sr-only">{`, ${group.items.length} items`}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        </button>
      </h2>
      <div
        id={regionId}
        role="group"
        aria-label={group.title}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="-mx-1 min-h-0 overflow-hidden px-1 py-px">
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <ItemLink item={item} env={env} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}


/**
 * Grouped nav.
 * - Expanded (pinned / peek / mobile drawer): Overview and the Administration heading are plain;
 *   every other group is a collapsible section (button with aria-expanded/aria-controls, title,
 *   item count, chevron). The section holding the current page is always open.
 * - Collapsed rail: Overview items as individual icons, the Administration heading as an icon
 *   linking to /admin, every other group as ONE icon that opens a fly-out (see nav-flyout.tsx).
 */
export function NavList({
  groups,
  collapsed = false,
  onNavigate,
  roomy = false,
}: {
  groups: NavGroup[];
  collapsed?: boolean;
  /** Called when a link is clicked (the mobile drawer uses it to close). */
  onNavigate?: () => void;
  /** Taller touch-friendly rows (mobile drawer). */
  roomy?: boolean;
}) {
  const pathname = usePathname();
  const allHrefs = allNavHrefs(groups);
  const prefix = useId();
  const env: Env = { pathname, allHrefs, collapsed, roomy, prefix, onNavigate };

  return (
    <nav aria-label="Primary" className={cn("flex flex-col", collapsed ? "items-center gap-1.5" : "gap-1")}>
      {groups.map((group, gi) => {
        const prev = groups[gi - 1];
        if (collapsed) {
          const divider = gi > 0 && !prev?.heading ? <div aria-hidden className="my-1.5 h-px w-8 bg-line" /> : null;
          if (group.heading && group.href) {
            const active = isActivePath(pathname, group.href, allHrefs);
            const Icon = GROUP_ICONS[group.icon];
            return (
              <div key={group.id} className="flex flex-col items-center gap-1.5">
                {divider}
                <Link
                  href={group.href}
                  title={`${group.title} overview`}
                  aria-label={`${group.title} overview`}
                  aria-current={active ? "page" : undefined}
                  className={linkClasses(active, "h-11 w-11 justify-center")}
                >
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.9} aria-hidden />
                </Link>
              </div>
            );
          }
          return (
            <div key={group.id} className="flex flex-col items-center gap-1.5">
              {divider}
              {group.collapsible ? (
                <RailGroup group={group} pathname={pathname} allHrefs={allHrefs} />
              ) : (
                <ul role="group" aria-label={group.title} className="flex flex-col items-center gap-1.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <ItemLink item={item} env={env} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }

        if (group.heading && group.href) {
          const active = isActivePath(pathname, group.href, allHrefs);
          const Icon = GROUP_ICONS[group.icon];
          return (
            <div key={group.id} className="mt-2 border-t border-line pt-3">
              <h2 className="m-0">
                <Link
                  href={group.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={linkClasses(
                    active,
                    cn(roomy ? "h-11" : "h-9", "gap-3 px-3.5 text-[13px] font-bold uppercase tracking-wider whitespace-nowrap"),
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.9} aria-hidden />
                  <span className="truncate">{group.title}</span>
                </Link>
              </h2>
            </div>
          );
        }

        return (
          <div key={group.id} className={cn(gi > 0 && !prev?.heading && "mt-1")}>
            {group.collapsible ? (
              <Section group={group} env={env} />
            ) : (
              <>
                <h2 id={`${prefix}-${group.id}`} className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                  {group.title}
                </h2>
                <ul role="group" aria-labelledby={`${prefix}-${group.id}`} className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <ItemLink item={item} env={env} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}
