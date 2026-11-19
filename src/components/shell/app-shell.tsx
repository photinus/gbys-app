import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { getBranding } from "@/lib/dal/settings";
import { isFeatureEnabled } from "@/lib/features";
import { MobileNav } from "./mobile-nav";
import { NavCollapseProvider } from "./nav-collapse";
import { getNavGroups, INTRO_COOKIE, NAV_COLLAPSED_COOKIE, parseCollapsedCookie, SIDEBAR_COOKIE } from "./nav";
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
  const sidebarCookie = jar.get(SIDEBAR_COOKIE)?.value;
  // Legacy values: "expanded" -> pinned, "collapsed" -> unpinned. No cookie -> unpinned.
  const initialPinned = sidebarCookie === "pinned" || sidebarCookie === "expanded";
  // Intro only on the first render of a browser session (cookie is set by the client on mount).
  const initialIntro = !initialPinned && jar.get(INTRO_COOKIE)?.value !== "seen";
  const groups = getNavGroups(user.orgRole, {
    isShiftCoordinator: user.isShiftCoordinator,
    isProgramStaff: user.isProgramStaff,
    isSeatedDirector: user.isSeatedDirector,
    hasTeams: user.hasTeams,
    volunteerShifts: isFeatureEnabled("volunteerShifts"),
  });
  // Collapsed nav sections (read here so the first paint matches; no flash). The section holding
  // the current page is forced open on the client, which knows the pathname.
  const initialCollapsed = parseCollapsedCookie(jar.get(NAV_COLLAPSED_COOKIE)?.value, groups);

  return (
    <NavCollapseProvider initial={initialCollapsed}>
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
        initialPinned={initialPinned}
        initialIntro={initialIntro}
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
    </NavCollapseProvider>
  );
}
