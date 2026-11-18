import type { ReactNode } from "react";
import { UserMenu, type ShellUser } from "./user-menu";

/** Minimal desktop top bar: optional breadcrumb slot on the left, user menu on the right. */
export function TopBar({ user, breadcrumb }: { user: ShellUser; breadcrumb?: ReactNode }) {
  return (
    <header className="print:hidden hidden lg:flex items-center justify-between gap-4 pb-6">
      <div className="min-w-0 text-sm text-stone-500">{breadcrumb}</div>
      <div className="flex items-center gap-2.5 ml-auto">
        <UserMenu user={user} />
      </div>
    </header>
  );
}
