import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui";
import { RolesManager } from "@/components/volunteer-roles/roles-manager";
import type { RoleActions } from "@/components/volunteer-roles/types";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import {
  getProgramForRoles,
  getRoleTermOptions,
  listAssignmentsForReview,
  listManagedRoles,
  listRoleCredentialOptions,
} from "@/lib/dal/volunteer-roles";
import {
  approveAction,
  archiveRoleAction,
  assignAction,
  createRoleAction,
  declineAction,
  endAction,
  restoreRoleAction,
  updateRoleAction,
} from "./actions";

export const metadata: Metadata = { title: "Volunteer roles" };

const actions: RoleActions = {
  create: createRoleAction,
  update: updateRoleAction,
  archive: archiveRoleAction,
  restore: restoreRoleAction,
  approve: approveAction,
  decline: declineAction,
  end: endAction,
  assign: assignAction,
};

export default async function ProgramRolesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession(`/programs/${slug}/roles`);
  let data;
  try {
    data = await getProgramForRoles(ctx, slug);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const { program, canManage } = data;
  const scope = { programId: program.id };

  const [roles, reviews, termOptions] = await Promise.all([
    listManagedRoles(ctx, scope),
    listAssignmentsForReview(ctx, { scope }),
    getRoleTermOptions(ctx, program.id),
  ]);
  const credentials = await listRoleCredentialOptions(ctx, program.id, roles.flatMap((r) => r.requiredCredentialIds));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="min-w-0">
        <Link href={`/programs/${program.slug}`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          {program.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">Volunteer roles</h1>
        <p className="mt-1 text-sm text-stone-500">
          Positions volunteers can sign up for, the hours you expect from each, and who has been approved.
        </p>
        {!canManage ? (
          <Badge className="mt-2" tone="neutral">
            Read-only
          </Badge>
        ) : null}
      </div>
      <RolesManager
        programId={program.id}
        roles={roles}
        reviews={reviews}
        credentials={credentials}
        terms={{ seasonsByProgram: { [program.id]: termOptions.seasons }, currentYear: termOptions.currentYear }}
        canManage={canManage}
        isBoard={isBoard(ctx)}
        actions={actions}
        scopeLabel={program.name}
      />
    </div>
  );
}
