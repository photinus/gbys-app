import type { ReactNode } from "react";
import { getNavItems } from "./nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import type { ShellUser } from "./user-menu";

export type { ShellUser };

/** Authenticated app chrome: icon rail + pill tab bar + content area. Server component. */
export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const items = getNavItems(user.orgRole, {
    isShiftCoordinator: user.isShiftCoordinator,
    isProgramStaff: user.isProgramStaff,
  });

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <Sidebar items={items} />
      <div className="flex-1 flex flex-col min-w-0 max-w-[1600px] mx-auto w-full px-4 sm:px-8 py-5 sm:py-6">
        <div className="print:hidden">
          <TopBar items={items} user={user} />
        </div>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
