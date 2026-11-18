"use client";

import { useState, useTransition } from "react";
import { Button, Select, useToast } from "@/components/ui";
import { changeRoleAction } from "@/app/(admin)/admin/users/[id]/actions";
import { ORG_ROLES, ORG_ROLE_LABELS, type OrgRoleValue } from "@/lib/validation/users-admin";
import { RoleBadge } from "./badges";

export function RolePanel({
  userId,
  role,
  canChange,
  isSelf,
  isActive,
}: {
  userId: string;
  role: OrgRoleValue;
  canChange: boolean;
  isSelf: boolean;
  isActive: boolean;
}) {
  const toast = useToast();
  const [value, setValue] = useState<OrgRoleValue>(role);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canChange) {
    return (
      <div className="space-y-2 text-sm">
        <RoleBadge role={role} />
        <p className="text-xs text-stone-500" data-testid="role-readonly-note">
          {isSelf
            ? "You can't change your own role."
            : !isActive
              ? "Restore this user before changing their role."
              : "Only super admins can change roles."}
        </p>
      </div>
    );
  }

  const save = () => {
    setError(null);
    start(async () => {
      const res = await changeRoleAction(userId, value);
      if (res.ok) toast.success("Role updated");
      else {
        setError(res.error);
        setValue(role);
      }
    });
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:w-60">
          <Select
            aria-label="Organization role"
            name="orgRole"
            value={value}
            onChange={(e) => setValue(e.target.value as OrgRoleValue)}
            disabled={pending}
          >
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {ORG_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={save} disabled={pending || value === role}>
          {pending ? "Saving..." : "Change role"}
        </Button>
      </div>
      <p className="text-xs text-stone-500">
        Board members can see every admin page. Super admins can also change roles. Role changes are audited.
      </p>
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}
