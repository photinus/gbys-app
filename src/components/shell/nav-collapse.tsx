"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { NAV_COLLAPSED_COOKIE, serializeCollapsed } from "./nav";

interface NavCollapseValue {
  /**
   * Effective expanded state of a collapsible group. The group holding the current page is always
   * expanded on arrival (whatever the cookie says); toggling it afterwards only affects this view.
   */
  isExpanded: (id: string, pathname: string | null, hasActive: boolean) => boolean;
  toggle: (id: string, pathname: string | null, hasActive: boolean) => void;
}

const Ctx = createContext<NavCollapseValue | null>(null);

/**
 * Shared collapsed-sections state for the desktop sidebar and the mobile drawer. `initial` comes
 * from the gbys_nav_collapsed cookie read server-side (AppShell), so first paint matches. Toggles
 * are written back to that cookie (1 year, path=/).
 */
export function NavCollapseProvider({ initial, children }: { initial: string[]; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<string[]>(initial);
  // Per-view overrides for the active group, keyed by pathname so they reset on navigation.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const isExpanded = useCallback(
    (id: string, pathname: string | null, hasActive: boolean) => {
      const o = overrides[`${pathname}::${id}`];
      if (o !== undefined) return o;
      return hasActive || !collapsed.includes(id);
    },
    [collapsed, overrides],
  );

  const toggle = useCallback(
    (id: string, pathname: string | null, hasActive: boolean) => {
      const expanded = isExpanded(id, pathname, hasActive);
      const next = expanded ? Array.from(new Set([...collapsed, id])) : collapsed.filter((c) => c !== id);
      setCollapsed(next);
      setOverrides((prev) => ({ ...prev, [`${pathname}::${id}`]: !expanded }));
      try {
        document.cookie = `${NAV_COLLAPSED_COOKIE}=${serializeCollapsed(next)}; path=/; max-age=31536000; samesite=lax`;
      } catch {
        // cookies blocked: state still works for this page view
      }
    },
    [collapsed, isExpanded],
  );

  const value = useMemo(() => ({ isExpanded, toggle }), [isExpanded, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNavCollapse(): NavCollapseValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNavCollapse must be used inside NavCollapseProvider");
  return v;
}
