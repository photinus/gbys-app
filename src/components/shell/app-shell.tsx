import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getBranding } from "@/lib/dal/settings";
import { MobileNav } from "./mobile-nav";
import { getNavGroups, SIDEBAR_COOKIE } from "./nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import type { ShellUser } from "./user-menu";

export type { ShellUser };

/**
 * Authenticated app chrome: grouped collapsible sidebar (lg+), mobile top bar + drawer, minimal
 * desktop top bar and content area. Server component: reads the sidebar cookie and branding so
 * the first paint is correct.
 */
export async function AppShell({
  user,
  breadcrumb,
  children,
}: {
  user: ShellUser;
  /** Optional page-level breadcrumb rendered in the desktop top bar. */
  breadcrumb?: ReactNode;
  children: ReactNode;
}) {
  const [branding, jar] = await Promise.all([getBranding(), cookies()]);
  const initialCollapsed = jar.get(SIDEBAR_COOKIE)?.value === "collapsed";
  const groups = getNavGroups(user.orgRole, {
    isShiftCoordinator: user.isShiftCoordinator,
    isProgramStaff: user.isProgramStaff,
  });

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-charcoal focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <Sidebar
        groups={groups}
        orgName={branding.orgName}
        logoUrl={branding.logoUrl}
        initialCollapsed={initialCollapsed}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileNav
          groups={groups}
          user={user}
          orgName={branding.orgName}
          shortName={branding.shortName}
          logoUrl={branding.logoUrl}
        />
        <div className="flex-1 flex flex-col max-w-[1600px] mx-auto w-full px-4 sm:px-8 py-5 sm:py-6">
          <TopBar user={user} breadcrumb={breadcrumb} />
          <main id="main-content" className="flex-1 min-w-0 focus:outline-none" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
