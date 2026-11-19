"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useDialog } from "@/components/ui/use-dialog";
import { Logo } from "./logo";
import type { NavGroup } from "./nav";
import { NavList } from "./nav-list";
import { UserMenu, type ShellUser } from "./user-menu";

/** Below lg: slim sticky top bar (hamburger, brand, user menu) + slide-in drawer on native <dialog>. */
export function MobileNav({
  groups,
  user,
  orgName,
  shortName,
  logoUrl,
}: {
  groups: NavGroup[];
  user: ShellUser;
  orgName: string;
  shortName: string;
  logoUrl: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Native <dialog> gives focus trapping, Esc to close and focus restoration to the hamburger.
  const ref = useDialog(open, close);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close if the viewport grows into the desktop layout.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => mq.matches && setOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <>
      <header className="print:hidden lg:hidden sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-rail px-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={open}
          aria-haspopup="dialog"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-200/70 hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <Logo href="/dashboard" logoUrl={logoUrl} name={orgName} className="h-10 w-10" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">{shortName}</span>
        <UserMenu user={user} />
      </header>

      <dialog
        ref={ref}
        aria-label="Navigation menu"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="print:hidden m-0 mr-auto h-dvh max-h-dvh w-[min(20rem,calc(100vw-3rem))] max-w-none overflow-hidden border-r border-line bg-rail p-0 text-charcoal shadow-2xl backdrop:bg-charcoal/30 backdrop:backdrop-blur-[2px] -translate-x-full opacity-0 open:translate-x-0 open:opacity-100 starting:open:-translate-x-full starting:open:opacity-0 transition-[transform,opacity,overlay,display] duration-200 transition-discrete motion-reduce:transition-none"
      >
        {open ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 px-5 pb-3 pt-5">
              <Logo href="/dashboard" logoUrl={logoUrl} name={orgName} />
              <span className="min-w-0 flex-1 text-sm font-bold leading-tight tracking-tight line-clamp-2">
                {orgName}
              </span>
              <button
                type="button"
                onClick={close}
                aria-label="Close navigation menu"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-200/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/80"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-6 pt-2">
              <NavList groups={groups} onNavigate={close} roomy />
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
