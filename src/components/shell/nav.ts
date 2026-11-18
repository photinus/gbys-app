export type OrgRole = "super_admin" | "board_member" | "member";

export type NavIconKey = "dashboard" | "household" | "credentials" | "compliance";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconKey;
}

const MEMBER_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Household", href: "/household", icon: "household" },
  { label: "Credentials", href: "/volunteer/credentials", icon: "credentials" },
];

const BOARD_ITEMS: NavItem[] = [
  { label: "Compliance", href: "/admin/compliance", icon: "compliance" },
];

export function getNavItems(orgRole: OrgRole): NavItem[] {
  return orgRole === "super_admin" || orgRole === "board_member"
    ? [...MEMBER_ITEMS, ...BOARD_ITEMS]
    : [...MEMBER_ITEMS];
}

export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
