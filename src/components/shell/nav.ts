/** Cookie holding the desktop sidebar state ("collapsed" | "expanded"), read server-side. */
export const SIDEBAR_COOKIE = "gbys_sidebar";
/** Session cookie (no expiry): set once the first-load sidebar intro has been shown. */
export const INTRO_COOKIE = "gbys_sidebar_intro";
/** Cookie listing the collapsed nav group ids (comma list, "none" when all are open), read server-side. */
export const NAV_COLLAPSED_COOKIE = "gbys_nav_collapsed";

export type OrgRole = "super_admin" | "board_member" | "member";

export type NavIconKey =
  | "dashboard"
  | "household"
  | "credentials"
  | "registrations"
  | "programHub"
  | "shifts"
  | "roles"
  | "volunteerRoles"
  | "hours"
  | "checkin"
  | "overview"
  | "users"
  | "compliance"
  | "hoursReview"
  | "grants"
  | "programs"
  | "settings"
  | "audit"
  | "board"
  | "boardAdmin"
  | "boardVotes"
  | "contact"
  | "schedule"
  | "teams"
  | "facilities"
  | "payments"
  | "finance"
  | "banking"
  | "journal"
  | "reports"
  | "ledgerAccounts"
  | "financeSettings"
  | "payables"
  | "receivables"
  | "donations"
  | "budgets"
  | "reimbursements";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
}

/** Icon shown for a whole group in the collapsed rail (see GROUP_ICONS in nav-icons.ts). */
export type GroupIconKey =
  | "overview"
  | "family"
  | "volunteer"
  | "programs"
  | "admin"
  | "people"
  | "operations"
  | "money"
  | "governance"
  | "finance";

export interface NavGroup {
  id: string;
  title: string;
  icon: GroupIconKey;
  items: NavItem[];
  /** Sections the user can fold. Overview and the Administration heading never are. */
  collapsible: boolean;
  /** Folded on first visit (no gbys_nav_collapsed cookie yet). */
  defaultCollapsed?: boolean;
  /** Heading-only entry (no items) whose title links to `href`: the Administration overview. */
  heading?: boolean;
  href?: string;
}

export interface NavOptions {
  /** Board, program admins, head coaches and team managers get the coordinator entry. */
  isShiftCoordinator?: boolean;
  /** Board or any program staff role: program hub (seasons, rosters, emergency sheets). */
  isProgramStaff?: boolean;
  /** Currently seated voting director with a linked account: "My votes" entry. */
  isSeatedDirector?: boolean;
  /** Assigned as staff on at least one active team: "My teams" entry. */
  hasTeams?: boolean;
  /** Finance access: org-wide level, "program" for program-scoped grants only, undefined = none. */
  finance?: "admin" | "editor" | "viewer" | "program";
  /** FEATURE_VOLUNTEER_SHIFTS: shift scheduling entries show only when true (default off). */
  volunteerShifts?: boolean;
}

/**
 * Grouped sidebar navigation for a role. Empty groups are dropped. Board users get a
 * non-collapsible "Administration" heading (links to /admin) followed by four collapsible
 * admin sections; they reach program hubs via Administration > Programs and the board via
 * /admin/board, so "Program hubs" and "Board meetings" are not repeated for them.
 */
export function getNavGroups(orgRole: OrgRole, opts: NavOptions = {}): NavGroup[] {
  const board = orgRole === "super_admin" || orgRole === "board_member";
  const shiftsOn = !!opts.volunteerShifts;
  const coordinator = shiftsOn && (board || !!opts.isShiftCoordinator);

  const programs: NavItem[] = [
    ...(!board && opts.isProgramStaff ? [{ label: "My programs", href: "/programs", icon: "programHub" as const }] : []),
    ...(opts.hasTeams ? [{ label: "My teams", href: "/teams", icon: "teams" as const }] : []),
    ...(coordinator
      ? [{ label: "Manage shifts", href: "/volunteer/shifts/manage", icon: "checkin" as const }]
      : []),
  ];

  const admin = (id: string, title: string, icon: GroupIconKey, items: NavItem[]): NavGroup => ({
    id,
    title,
    icon,
    items,
    collapsible: true,
    defaultCollapsed: true,
  });

  const groups: NavGroup[] = [
    {
      id: "overview",
      title: "Overview",
      icon: "overview",
      collapsible: false,
      items: [
        { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
        ...(board ? [] : [{ label: "Board meetings", href: "/board", icon: "board" as const }]),
        ...(opts.isSeatedDirector ? [{ label: "My votes", href: "/board/votes", icon: "boardVotes" as const }] : []),
      ],
    },
    {
      id: "family",
      title: "My family",
      icon: "family",
      collapsible: true,
      items: [
        { label: "Household", href: "/household", icon: "household" },
        { label: "Registrations", href: "/registrations", icon: "registrations" },
        { label: "Schedule", href: "/schedule", icon: "schedule" },
      ],
    },
    {
      id: "volunteer",
      title: "Volunteer",
      icon: "volunteer",
      collapsible: true,
      items: [
        { label: "Credentials", href: "/volunteer/credentials", icon: "credentials" },
        { label: "Roles", href: "/volunteer/roles", icon: "roles" },
        { label: "Hours", href: "/volunteer/hours", icon: "hours" },
        { label: "Reimbursements", href: "/reimbursements", icon: "reimbursements" },
        ...(shiftsOn ? [{ label: "Shifts", href: "/volunteer/shifts", icon: "shifts" as const }] : []),
      ],
    },
    { id: "programs", title: "Programs & teams", icon: "programs", collapsible: true, items: programs },
  ];

  if (opts.finance) {
    const orgWide = opts.finance !== "program";
    groups.push({
      id: "finance",
      title: "Finance",
      icon: "finance",
      collapsible: true,
      defaultCollapsed: true,
      items: [
        { label: "Finance overview", href: "/finance", icon: "finance" },
        ...(orgWide ? [{ label: "Banking", href: "/finance/banking", icon: "banking" as const }] : []),
        { label: "Bills & payables", href: "/finance/payables", icon: "payables" },
        ...(orgWide
          ? [
              { label: "Invoices", href: "/finance/receivables", icon: "receivables" as const },
              { label: "Donations", href: "/finance/donations", icon: "donations" as const },
              { label: "Journal", href: "/finance/journal", icon: "journal" as const },
            ]
          : []),
        { label: "Budgets", href: "/finance/budgets", icon: "budgets" },
        { label: "Reports", href: "/finance/reports", icon: "reports" },
        ...(orgWide ? [{ label: "Accounts & funds", href: "/finance/accounts", icon: "ledgerAccounts" as const }] : []),
        ...(opts.finance === "admin"
          ? [{ label: "Finance settings", href: "/finance/settings", icon: "financeSettings" as const }]
          : []),
      ],
    });
  }

  if (board) {
    groups.push(
      { id: "admin", title: "Administration", icon: "admin", collapsible: false, heading: true, href: "/admin", items: [] },
      admin("admin-people", "People", "people", [
        { label: "Users", href: "/admin/users", icon: "users" },
        { label: "Compliance", href: "/admin/compliance", icon: "compliance" },
        { label: "Volunteer roles", href: "/admin/volunteer-roles", icon: "volunteerRoles" },
        { label: "Hours review", href: "/admin/hours", icon: "hoursReview" },
      ]),
      admin("admin-programs", "Programs & facilities", "operations", [
        { label: "Programs", href: "/admin/programs", icon: "programs" },
        { label: "Facilities", href: "/admin/facilities", icon: "facilities" },
        { label: "Contact forms", href: "/admin/contact", icon: "contact" },
      ]),
      admin("admin-money", "Money & reporting", "money", [
        { label: "Payments", href: "/admin/payments", icon: "payments" },
        { label: "Grants", href: "/admin/grants", icon: "grants" },
      ]),
      admin("admin-governance", "Governance", "governance", [
        { label: "Board of Directors", href: "/admin/board", icon: "boardAdmin" },
        { label: "Audit log", href: "/admin/audit", icon: "audit" },
        { label: "Settings", href: "/admin/settings", icon: "settings" },
      ]),
    );
  }
  return groups.filter((g) => g.heading || g.items.length > 0);
}

/** Every href in the nav (items and heading links), for most-specific-match active checks. */
export function allNavHrefs(groups: NavGroup[]): string[] {
  return groups.flatMap((g) => [...(g.href ? [g.href] : []), ...g.items.map((i) => i.href)]);
}

/** Whether any item of the group is the current page. */
export function groupHasActive(group: NavGroup, pathname: string | null, allHrefs: string[]): boolean {
  return group.items.some((i) => isActivePath(pathname, i.href, allHrefs));
}

/** Ids of the groups that start collapsed when the user has not chosen yet. */
export function defaultCollapsedIds(groups: NavGroup[]): string[] {
  return groups.filter((g) => g.collapsible && g.defaultCollapsed).map((g) => g.id);
}

/** Parse the gbys_nav_collapsed cookie (comma list; "none" = everything open). Unknown ids dropped. */
export function parseCollapsedCookie(value: string | undefined, groups: NavGroup[]): string[] {
  if (value === undefined) return defaultCollapsedIds(groups);
  const known = new Set(groups.filter((g) => g.collapsible).map((g) => g.id));
  return value.split(",").filter((id) => known.has(id));
}

export function serializeCollapsed(ids: string[]): string {
  return ids.length ? ids.join(",") : "none";
}

/**
 * Active when the path matches href or is nested under it, unless a more specific
 * nav item claims the path (e.g. /admin/users vs /admin, /volunteer/shifts/manage vs /volunteer/shifts).
 */
export function isActivePath(pathname: string | null, href: string, allHrefs: string[] = []): boolean {
  if (!pathname) return false;
  const matches = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  if (!matches(href)) return false;
  return !allHrefs.some((h) => h !== href && h.length > href.length && h.startsWith(href) && matches(h));
}
