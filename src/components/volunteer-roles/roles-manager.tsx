"use client";

import { Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader } from "@/components/ui";
import type { ManagedRole, ReviewRow, RoleCredentialOption } from "@/lib/dal/volunteer-roles";
import { AssignModal, type AssignTerms } from "./assign-modal";
import { RoleFormModal } from "./role-form-modal";
import { RolesTable } from "./roles-table";
import { SignupsPanel } from "./signups-panel";
import type { RoleActions } from "./types";

/** Roles catalog + sign-ups review for one scope (a program, or org-wide). */
export function RolesManager({
  programId,
  roles,
  reviews,
  credentials,
  terms,
  canManage,
  isBoard,
  actions,
  scopeLabel,
}: {
  programId: string | null;
  roles: ManagedRole[];
  reviews: ReviewRow[];
  credentials: RoleCredentialOption[];
  terms: AssignTerms;
  canManage: boolean;
  isBoard: boolean;
  actions: RoleActions;
  scopeLabel: string;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedRole | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignRoleId, setAssignRoleId] = useState<string | null>(null);

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Roles"
          description={`Volunteer positions for ${scopeLabel}. Expected hours are per term.`}
          action={
            canManage ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setAssignRoleId(null);
                    setAssignOpen(true);
                  }}
                >
                  <UserPlus className="h-4 w-4" /> Assign volunteer
                </Button>
                <Button size="sm" onClick={() => setFormOpen(true)}>
                  <Plus className="h-4 w-4" /> New role
                </Button>
              </>
            ) : null
          }
        />
        <RolesTable
          roles={roles}
          onEdit={(r) => {
            setEditing(r);
            setFormOpen(true);
          }}
          onAssign={(r) => {
            setAssignRoleId(r.id);
            setAssignOpen(true);
          }}
          actions={actions}
        />
      </Card>

      <Card>
        <CardHeader title="Sign-ups" description="Approve, decline or end volunteer assignments. Logged hours are never deleted." />
        <SignupsPanel rows={reviews} actions={actions} />
      </Card>

      <RoleFormModal
        open={formOpen}
        onClose={closeForm}
        programId={programId}
        role={editing}
        credentials={credentials}
        isBoard={isBoard}
        actions={actions}
      />
      <AssignModal
        key={assignRoleId ?? "any"}
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        roles={roles}
        initialRoleId={assignRoleId}
        terms={terms}
        action={actions.assign}
      />
    </div>
  );
}
