"use client";

import {
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Trophy,
  Clock,
  FileSpreadsheet,
  FolderKanban,
  LayoutGrid,
  ListChecks,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { isActivePath, type NavIconKey, type NavItem } from "./nav";

const ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: LayoutGrid,
  household: Users,
  credentials: ShieldCheck,
  registrations: ClipboardList,
  programHub: Trophy,
  shifts: CalendarDays,
  hours: Clock,
  checkin: CalendarCheck,
  compliance: ClipboardCheck,
  hoursReview: ListChecks,
  grants: FileSpreadsheet,
  programs: FolderKanban,
};

/** Slim icon rail on lg+, compact brand bar on small screens (PillTabs handle mobile nav). */
export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <aside className="print:hidden w-full lg:w-20 bg-rail border-b lg:border-b-0 lg:border-r border-line flex lg:flex-col items-center justify-between px-4 py-3 lg:py-6 shrink-0 sticky top-0 z-30 lg:h-screen lg:self-start">
      <div className="flex items-center gap-3 lg:flex-col">
        <Logo href="/dashboard" />
        <span className="font-bold text-sm tracking-tight lg:hidden">Gold Beach Youth Sports</span>
      </div>

      <nav aria-label="Primary" className="hidden lg:flex flex-col items-center gap-3 my-auto">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActivePath(pathname, item.href, items.map((i) => i.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "w-11 h-11 rounded-full flex items-center justify-center transition-all",
                active
                  ? "bg-periwinkle/35 text-charcoal"
                  : "text-stone-500 hover:bg-stone-200/70 hover:text-charcoal",
              )}
            >
              <Icon className="w-5 h-5" strokeWidth={active ? 2 : 1.9} />
            </Link>
          );
        })}
      </nav>

      {/* Spacer keeps the nav vertically centered, like the mockup's bottom utility group */}
      <div className="hidden lg:block w-11 h-11" aria-hidden />
    </aside>
  );
}
