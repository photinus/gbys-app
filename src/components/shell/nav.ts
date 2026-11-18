/** Cookie holding the desktop sidebar state ("collapsed" | "expanded"), read server-side. */
export const SIDEBAR_COOKIE = "gbys_sidebar";

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
  | "boardAdmin";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

export interface NavOptions {
  /** Board, program admins, head coaches and team managers get the coordinator entry. */
  isShiftCoordinator?: boolean;
  /** Board or any program staff role: program hub (seasons, rosters, emergency sheets). */
  isProgramStaff?: boolean;
  /** FEATURE_VOLUNTEER_SHIFTS: shift scheduling entries show only when true (default off). */
  volunteerShifts?: boolean;
}

/** Grouped sidebar navigation for a role. Empty groups are dropped. */
export function getNavGroups(orgRole: OrgRole, opts: NavOptions = {}): NavGroup[] {
  const board = orgRole === "super_admin" || orgRole === "board_member";
  const staff = board || !!opts.isProgramStaff;
  const shiftsOn = !!opts.volunteerShifts;
  const coordinator = shiftsOn && (board || !!opts.isShiftCoordinator);

  const programs: NavItem[] = [
    ...(staff ? [{ label: board ? "Program hubs" : "My programs", href: "/programs", icon: "programHub" as const }] : []),
    ...(coordinator
      ? [{ label: "Manage shifts", href: "/volunteer/shifts/manage", icon: "checkin" as const }]
      : []),
  ];

  const groups: NavGroup[] = [
    {
      id: "overview",
      title: "Overview",
      items: [
        { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
        { label: "Board meetings", href: "/board", icon: "board" },
      ],
    },
    {
      id: "family",
      title: "My family",
      items: [
        { label: "Household", href: "/household", icon: "household" },
        { label: "Registrations", href: "/registrations", icon: "registrations" },
      ],
    },
    {
      id: "volunteer",
      title: "Volunteer",
      items: [
        { label: "Credentials", href: "/volunteer/credentials", icon: "credentials" },
        { label: "Roles", href: "/volunteer/roles", icon: "roles" },
        ...(shiftsOn ? [{ label: "Shifts", href: "/volunteer/shifts", icon: "shifts" as const }] : []),
        { label: "Hours", href: "/volunteer/hours", icon: "hours" },
      ],
    },
    { id: "programs", title: "Programs", items: programs },
    {
      id: "admin",
      title: "Administration",
      items: board
        ? [
            { label: "Overview", href: "/admin", icon: "overview" },
            { label: "Users", href: "/admin/users", icon: "users" },
            { label: "Volunteer roles", href: "/admin/volunteer-roles", icon: "volunteerRoles" },
            { label: "Compliance", href: "/admin/compliance", icon: "compliance" },
            { label: "Hours review", href: "/admin/hours", icon: "hoursReview" },
            { label: "Grants", href: "/admin/grants", icon: "grants" },
            { label: "Programs", href: "/admin/programs", icon: "programs" },
            { label: "Settings", href: "/admin/settings", icon: "settings" },
            { label: "Board of Directors", href: "/admin/board", icon: "boardAdmin" },
            { label: "Audit log", href: "/admin/audit", icon: "audit" },
          ]
        : [],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
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
