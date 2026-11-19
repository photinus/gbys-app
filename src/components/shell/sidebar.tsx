"use client";

import { PanelLeftClose, PanelLeftOpen, Pin, PinOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { INTRO_COOKIE, SIDEBAR_COOKIE, type NavGroup } from "./nav";
import { NavList } from "./nav-list";

const INTRO_MS = 3000;
const LEAVE_COLLAPSE_MS = 300;
const PEEK_OPEN_MS = 200;
const PEEK_CLOSE_MS = 150;

/**
 * Desktop (lg+) sidebar with pinned / unpinned modes. `initialPinned` comes from the gbys_sidebar
 * cookie and `initialIntro` from the session cookie gbys_sidebar_intro (both read server-side by
 * AppShell).
 * - Pinned: always expanded, reserves the full width, no intro.
 * - Unpinned, first render of the browser session (`initialIntro`): expanded and PUSHING content
 *   (slot reserves 248px) for ~3s, then collapses to the 80px rail once. Hover / keyboard focus
 *   cancels the auto-collapse until the pointer leaves / focus leaves.
 * - Unpinned otherwise: the 80px rail. Hover-to-peek is an overlay that opens after ~200ms of
 *   continuous hover and closes ~150ms after leave; clicking a link closes it at once.
 * - Rail vs fly-outs (one consistent rule): hovering the rail BACKGROUND (logo, gaps, footer,
 *   Overview icons) still peeks the whole sidebar, but hovering a GROUP icon opens that group's
 *   fly-out menu (nav-flyout.tsx) and cancels the pending peek. Likewise keyboard focus on a
 *   group icon opens its fly-out, so keyboard focus inside the collapsed rail does NOT expand the
 *   sidebar (it would hide the fly-outs); keyboard users expand it with the "Expand sidebar"
 *   button or pin it. Keyboard focus while already expanded (peek / intro) behaves as before.
 */
export function Sidebar({
  groups,
  orgName,
  logoUrl,
  initialPinned,
  initialIntro,
}: {
  groups: NavGroup[];
  orgName: string;
  logoUrl: string | null;
  initialPinned: boolean;
  initialIntro: boolean;
}) {
  const [pinned, setPinned] = useState(initialPinned);
  const [intro, setIntro] = useState(initialIntro && !initialPinned);
  const [peek, setPeek] = useState(false);
  const hovered = useRef(false);
  // Pointer is over a rail group icon / its fly-out ([data-rail-flyout]): the fly-out wins, no peek.
  const overFlyout = useRef(false);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const later = useCallback(
    (ms: number, fn: () => void) => {
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        fn();
      }, ms);
    },
    [clearTimer],
  );
  const endIntroLater = useCallback(
    (ms: number) =>
      later(ms, () => {
        if (!hovered.current && !focused.current) setIntro(false);
      }),
    [later],
  );

  // Once per mount: mark the intro as seen for this browser session, and run it if it was rendered.
  useEffect(() => {
    try {
      document.cookie = `${INTRO_COOKIE}=seen; path=/; samesite=lax`;
    } catch {
      // cookies blocked: worst case the intro replays on the next full load
    }
    if (initialIntro && !initialPinned) endIntroLater(INTRO_MS);
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expanded = pinned || intro || peek;
  const overlay = !pinned && !intro && peek;

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
    setIntro(false);
    setPeek(false);
    writeCookie("unpinned");
  }

  function togglePin() {
    clearTimer();
    if (pinned) {
      setPinned(false);
      setPeek(true);
      writeCookie("unpinned");
      if (!hovered.current && !focused.current)
        later(PEEK_CLOSE_MS, () => setPeek(false));
    } else {
      setPinned(true);
      setIntro(false);
      setPeek(false);
      writeCookie("pinned");
    }
  }

  function onEnter() {
    hovered.current = true;
    clearTimer();
    if (pinned || intro || peek) return;
    later(PEEK_OPEN_MS, () => {
      if (hovered.current && !overFlyout.current) setPeek(true);
    });
  }
  function onOver(e: React.MouseEvent) {
    const inFlyout = !!(e.target as HTMLElement).closest?.("[data-rail-flyout]");
    if (inFlyout === overFlyout.current) return;
    overFlyout.current = inFlyout;
    if (pinned || intro || peek || !hovered.current) return;
    if (inFlyout) clearTimer();
    else
      later(PEEK_OPEN_MS, () => {
        if (hovered.current && !overFlyout.current) setPeek(true);
      });
  }
  function onLeave() {
    hovered.current = false;
    overFlyout.current = false;
    if (pinned) return;
    if (intro) return endIntroLater(LEAVE_COLLAPSE_MS);
    if (focused.current) {
      clearTimer();
      return;
    }
    later(PEEK_CLOSE_MS, () => setPeek(false));
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
    if (!pinned && !intro && !peek) return; // rail: group icons open fly-outs instead of peeking
    focused.current = true;
    clearTimer();
    if (!pinned && !intro) setPeek(true);
  }
  function onBlur(e: React.FocusEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    focused.current = false;
    if (pinned) return;
    if (intro) return endIntroLater(LEAVE_COLLAPSE_MS);
    if (!hovered.current) later(PEEK_CLOSE_MS, () => setPeek(false));
  }
  function onClickCapture(e: React.MouseEvent) {
    if (pinned || intro) return;
    if ((e.target as HTMLElement).closest("a")) {
      clearTimer();
      setPeek(false);
    }
  }

  const collapsed = !expanded;
  const btn =
    "flex h-11 items-center rounded-full text-sm font-medium text-stone-500 transition-colors hover:bg-stone-200/70 hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80";

  return (
    <div
      data-pinned={pinned ? "true" : "false"}
      onMouseEnter={onEnter}
      onMouseOver={onOver}
      onMouseLeave={onLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onClickCapture={onClickCapture}
      className={cn(
        "print:hidden hidden lg:block shrink-0 sticky top-0 h-screen z-30",
        "transition-[width] duration-300 ease-out motion-reduce:transition-none",
        pinned || intro ? "w-[248px]" : "w-20",
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
            "flex items-center gap-3 pt-5 pb-3",
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
                setPeek(true);
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
