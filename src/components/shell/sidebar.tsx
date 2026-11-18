"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { SIDEBAR_COOKIE, type NavGroup } from "./nav";
import { NavList } from "./nav-list";

/**
 * Desktop (lg+) collapsible sidebar. `initialCollapsed` comes from the gbys_sidebar cookie,
 * read server-side by AppShell, so the first paint already has the right width.
 */
export function Sidebar({
  groups,
  orgName,
  logoUrl,
  initialCollapsed,
}: {
  groups: NavGroup[];
  orgName: string;
  logoUrl: string | null;
  initialCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // cookies blocked: state still works for this page view
    }
  }

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "print:hidden hidden lg:flex flex-col shrink-0 sticky top-0 h-screen z-30 overflow-hidden bg-rail border-r border-line",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-20" : "w-[248px]",
      )}
    >
      <div className={cn("flex items-center gap-3 pt-6 pb-4", collapsed ? "justify-center px-4" : "px-5")}>
        <Logo href="/dashboard" logoUrl={logoUrl} name={orgName} />
        {collapsed ? null : (
          <span className="min-w-0 text-sm font-bold leading-tight tracking-tight line-clamp-2">{orgName}</span>
        )}
      </div>

      <div className={cn("flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-2", collapsed ? "px-4" : "px-3")}>
        <NavList groups={groups} collapsed={collapsed} />
      </div>

      <div className={cn("border-t border-line py-3", collapsed ? "flex justify-center px-4" : "px-3")}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex h-11 items-center rounded-full text-sm font-medium text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80",
            collapsed ? "w-11 justify-center" : "w-full gap-3 px-3.5 whitespace-nowrap",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5" aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
