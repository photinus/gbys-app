"use client";

import { PanelLeftClose, PanelLeftOpen, Pin, PinOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { SIDEBAR_COOKIE, type NavGroup } from "./nav";
import { NavList } from "./nav-list";

const AUTO_COLLAPSE_MS = 3000;
const LEAVE_COLLAPSE_MS = 300;

/**
 * Desktop (lg+) sidebar with pinned / unpinned modes. `initialPinned` comes from the gbys_sidebar
 * cookie (read server-side by AppShell). Pinned: always expanded and reserves the full width.
 * Unpinned: reserves only the 80px rail; the expanded sidebar is an overlay (content never
 * shifts). It starts expanded on every full page load (so the first paint shows labels), then
 * auto-collapses after ~3s unless hovered or keyboard-focused; hover / focus-within re-expands.
 */
export function Sidebar({
  groups,
  orgName,
  logoUrl,
  initialPinned,
}: {
  groups: NavGroup[];
  orgName: string;
  logoUrl: string | null;
  initialPinned: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  // Unpinned overlay state; starts open so server HTML and first paint show the labels.
  const [open, setOpen] = useState(true);
  const hovered = useRef(false);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const scheduleCollapse = useCallback(
    (ms: number) => {
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!hovered.current && !focused.current) setOpen(false);
      }, ms);
    },
    [clearTimer],
  );

  // Initial auto-collapse, once per full page load (the layout persists across navigations).
  useEffect(() => {
    if (!initialPinned) scheduleCollapse(AUTO_COLLAPSE_MS);
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expanded = pinned || open;
  const overlay = !pinned && open;

  function writeCookie(value: "pinned" | "unpinned") {
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // cookies blocked: state still works for this page view
    }
  }

  function collapseNow() {
    clearTimer();
    focused.current = false;
    setPinned(false);
    setOpen(false);
    writeCookie("unpinned");
  }

  function togglePin() {
    clearTimer();
    if (pinned) {
      setPinned(false);
      setOpen(true);
      writeCookie("unpinned");
      if (!hovered.current && !focused.current)
        scheduleCollapse(LEAVE_COLLAPSE_MS);
    } else {
      setPinned(true);
      writeCookie("pinned");
    }
  }

  function onEnter() {
    hovered.current = true;
    clearTimer();
    if (!pinned) setOpen(true);
  }
  function onLeave() {
    hovered.current = false;
    if (!pinned) scheduleCollapse(LEAVE_COLLAPSE_MS);
  }
  function onFocus(e: React.FocusEvent) {
    // Only keyboard focus keeps it open; a mouse click must not pin it open after the pointer leaves.
    let visible = true;
    try {
      visible = (e.target as HTMLElement).matches(":focus-visible");
    } catch {
      // older engines: treat as keyboard focus
    }
    if (!visible) return;
    focused.current = true;
    clearTimer();
    if (!pinned) setOpen(true);
  }
  function onBlur(e: React.FocusEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    focused.current = false;
    if (!pinned) scheduleCollapse(LEAVE_COLLAPSE_MS);
  }

  const collapsed = !expanded;
  const btn =
    "flex h-11 items-center rounded-full text-sm font-medium text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80";

  return (
    <div
      data-pinned={pinned ? "true" : "false"}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn(
        "print:hidden hidden lg:block shrink-0 sticky top-0 h-screen z-30",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        pinned ? "w-[248px]" : "w-20",
      )}
    >
      <aside
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "absolute inset-y-0 left-0 flex flex-col overflow-hidden bg-rail border-r border-line",
          "transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "w-20" : "w-[248px]",
          overlay && "shadow-[8px_0_32px_-8px_rgba(0,0,0,0.18)]",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 pt-6 pb-4",
            collapsed ? "justify-center px-4" : "px-5",
          )}
        >
          <Logo href="/dashboard" logoUrl={logoUrl} name={orgName} />
          {collapsed ? null : (
            <span className="min-w-0 text-sm font-bold leading-tight tracking-tight line-clamp-2">
              {orgName}
            </span>
          )}
        </div>

        <div
          className={cn(
            "flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-2",
            collapsed ? "px-4" : "px-3",
          )}
        >
          <NavList groups={groups} collapsed={collapsed} />
        </div>

        <div
          className={cn(
            "border-t border-line py-3",
            collapsed
              ? "flex justify-center px-4"
              : "flex items-center gap-1 px-3",
          )}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                focused.current = true;
              }}
              aria-expanded={false}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className={cn(btn, "w-11 justify-center")}
            >
              <PanelLeftOpen className="h-5 w-5" aria-hidden />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={collapseNow}
                aria-expanded
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className={cn(
                  btn,
                  "min-w-0 flex-1 gap-3 px-3.5 whitespace-nowrap",
                )}
              >
                <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden />
                <span>Collapse</span>
              </button>
              <button
                type="button"
                onClick={togglePin}
                aria-pressed={pinned}
                aria-label="Keep sidebar open"
                title="Keep sidebar open"
                className={cn(
                  btn,
                  "w-11 shrink-0 justify-center",
                  pinned && "bg-periwinkle/35 text-charcoal",
                )}
              >
                {pinned ? (
                  <PinOff className="h-5 w-5" aria-hidden />
                ) : (
                  <Pin className="h-5 w-5" aria-hidden />
                )}
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
