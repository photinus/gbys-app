import { Badge } from "@/components/ui/badge";
import { ORG_ROLE_LABELS, type OrgRoleValue } from "@/lib/validation/users-admin";

export function RoleBadge({ role }: { role: OrgRoleValue }) {
  const tone = role === "super_admin" ? "danger" : role === "board_member" ? "info" : "neutral";
  return <Badge tone={tone}>{ORG_ROLE_LABELS[role]}</Badge>;
}

export function StatusBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Deactivated"}</Badge>;
}
