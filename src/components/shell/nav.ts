export type OrgRole = "super_admin" | "board_member" | "member";

export type NavIconKey =
  | "dashboard"
  | "household"
  | "credentials"
  | "shifts"
  | "hours"
  | "checkin"
  | "compliance"
  | "hoursReview"
  | "grants"
  | "programs";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
}

export interface NavOptions {
  /** Board, program admins, head coaches and team managers get the coordinator entry. */
  isShiftCoordinator?: boolean;
}

const MEMBER_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Household", href: "/household", icon: "household" },
  { label: "Credentials", href: "/volunteer/credentials", icon: "credentials" },
  { label: "Shifts", href: "/volunteer/shifts", icon: "shifts" },
  { label: "Hours", href: "/volunteer/hours", icon: "hours" },
];

const COORDINATOR_ITEMS: NavItem[] = [
  { label: "Manage shifts", href: "/volunteer/shifts/manage", icon: "checkin" },
];

const BOARD_ITEMS: NavItem[] = [
  { label: "Compliance", href: "/admin/compliance", icon: "compliance" },
  { label: "Hours review", href: "/admin/hours", icon: "hoursReview" },
  { label: "Grants", href: "/admin/grants", icon: "grants" },
  { label: "Programs", href: "/admin/programs", icon: "programs" },
];

export function getNavItems(orgRole: OrgRole, opts: NavOptions = {}): NavItem[] {
  const board = orgRole === "super_admin" || orgRole === "board_member";
  return [
    ...MEMBER_ITEMS,
    ...(board || opts.isShiftCoordinator ? COORDINATOR_ITEMS : []),
    ...(board ? BOARD_ITEMS : []),
  ];
}

/**
 * Active when the path matches href or is nested under it, unless a more specific
 * nav item claims the path (e.g. /volunteer/shifts/manage vs /volunteer/shifts).
 */
export function isActivePath(pathname: string | null, href: string, allHrefs: string[] = []): boolean {
  if (!pathname) return false;
  const matches = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  if (!matches(href)) return false;
  return !allHrefs.some((h) => h !== href && h.length > href.length && h.startsWith(href) && matches(h));
}
