"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { groupHasActive, isActivePath, type NavGroup } from "./nav";
import { GROUP_ICONS, NAV_ICONS } from "./nav-icons";

const OPEN_MS = 200;
const CLOSE_MS = 150;

/**
 * Collapsed-rail entry for one group: a single icon that opens a fly-out menu to the right.
 *
 * Interaction model (shared with Sidebar): hovering the rail background still peeks the whole
 * sidebar, but hovering (or keyboard-focusing) a group icon opens ITS fly-out instead and
 * suppresses the peek (everything inside [data-rail-flyout] is exempt). Opens after ~200ms of
 * hover, closes ~150ms after the pointer leaves the icon + menu. Keyboard: focus on the icon
 * opens the menu; ArrowDown/ArrowRight/Enter/Space move into it, arrows/Home/End move between
 * items, Esc (or ArrowLeft) closes and returns focus to the icon, Tab leaves and closes.
 * Click outside closes. The menu is position:fixed so the rail's overflow clipping never cuts it.
 */
export function RailGroup({
  group,
  pathname,
  allHrefs,
}: {
  group: NavGroup;
  pathname: string | null;
  allHrefs: string[];
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const menuId = useId();
  const Icon = GROUP_ICONS[group.icon];
  const active = groupHasActive(group, pathname, allHrefs);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const schedule = useCallback(
    (next: boolean, ms: number) => {
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpen(next);
      }, ms);
    },
    [clear],
  );
  useEffect(() => clear, [clear]);

  // Place the fixed menu beside the rail, aligned to the icon and clamped to the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = triggerRef.current;
      const m = menuRef.current?.parentElement;
      if (!t || !m) return;
      const tr = t.getBoundingClientRect();
      const rail = t.closest("aside")?.getBoundingClientRect();
      m.style.left = `${(rail?.right ?? tr.right) + 6}px`;
      const top = Math.min(tr.top - 6, window.innerHeight - m.offsetHeight - 8);
      m.style.top = `${Math.max(8, top)}px`;
    };
    place();
    window.addEventListener("resize", place);
    const scroller = triggerRef.current?.closest(".overflow-y-auto");
    const onScroll = () => setOpen(false);
    scroller?.addEventListener("scroll", onScroll);
    return () => {
      window.removeEventListener("resize", place);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [open]);

  // Move focus into the menu when the keyboard opened it that way.
  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (items?.length) (pendingFocus.current === "last" ? items[items.length - 1] : items[0]).focus();
    pendingFocus.current = null;
  }, [open]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function closeToTrigger() {
    clear();
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        closeToTrigger();
      }
      return;
    }
    const first = e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "Enter" || e.key === " ";
    if (first || e.key === "ArrowUp") {
      e.preventDefault();
      clear();
      pendingFocus.current = first ? "first" : "last";
      if (open) {
        const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
        if (items?.length) (first ? items[0] : items[items.length - 1]).focus();
        pendingFocus.current = null;
      } else setOpen(true);
    }
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Escape" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      closeToTrigger();
      return;
    } else return;
    e.preventDefault();
    items[next]?.focus();
  }

  return (
    <div
      ref={wrapRef}
      data-rail-flyout
      onMouseEnter={() => schedule(true, OPEN_MS)}
      onMouseLeave={() => schedule(false, CLOSE_MS)}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) {
          clear();
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={group.title}
        onClick={() => {
          clear();
          setOpen((o) => !o);
        }}
        onFocus={(e) => {
          let visible = true;
          try {
            visible = e.currentTarget.matches(":focus-visible");
          } catch {
            // older engines: treat as keyboard focus
          }
          if (visible) {
            clear();
            setOpen(true);
          }
        }}
        onKeyDown={onTriggerKey}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80",
          active || open
            ? cn("text-charcoal", active ? "bg-periwinkle/35" : "bg-stone-200/70")
            : "text-stone-500 hover:bg-stone-200/70 hover:text-charcoal",
        )}
      >
        <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2 : 1.9} aria-hidden />
        {active ? <span className="sr-only">(contains current page)</span> : null}
      </button>

      {open ? (
        <div className="fixed z-50 min-w-[14rem] rounded-2xl border border-line bg-white p-2 shadow-xl" style={{ top: 0, left: 80 }}>
          <p className="px-3 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            {group.title}
          </p>
          <ul id={menuId} ref={menuRef} role="menu" aria-label={group.title} onKeyDown={onMenuKey} className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const ItemIcon = NAV_ICONS[item.icon];
              const itemActive = isActivePath(pathname, item.href, allHrefs);
              return (
                <li key={item.href} role="none">
                  <Link
                    href={item.href}
                    role="menuitem"
                    tabIndex={-1}
                    aria-current={itemActive ? "page" : undefined}
                    onClick={() => {
                      clear();
                      setOpen(false);
                    }}
                    className={cn(
                      "flex h-10 items-center gap-3 whitespace-nowrap rounded-full px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80",
                      itemActive
                        ? "bg-periwinkle/35 font-semibold text-charcoal"
                        : "font-medium text-stone-500 hover:bg-stone-200/70 hover:text-charcoal",
                    )}
                  >
                    <ItemIcon className="h-5 w-5 shrink-0" strokeWidth={itemActive ? 2 : 1.9} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
