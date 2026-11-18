import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui";
import { ProgramsOverview } from "@/components/volunteer-roles/programs-overview";
import { RolesManager } from "@/components/volunteer-roles/roles-manager";
import { SignupsPanel } from "@/components/volunteer-roles/signups-panel";
import type { RoleActions } from "@/components/volunteer-roles/types";
import { isBoard, requireSession } from "@/lib/dal/context";
import {
  getRoleTermOptions,
  listAssignmentsForReview,
  listManagedRoles,
  listRoleCredentialOptions,
} from "@/lib/dal/volunteer-roles";
import { cn } from "@/lib/utils";
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

export default async function AdminVolunteerRolesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireSession("/admin/volunteer-roles");
  if (!isBoard(ctx)) notFound();
  const { tab } = await searchParams;
  const active = tab === "programs" ? "programs" : "org";

  const [allRoles, allReviews, termOptions] = await Promise.all([
    listManagedRoles(ctx, { all: true }),
    listAssignmentsForReview(ctx, { scope: { all: true } }),
    getRoleTermOptions(ctx, null),
  ]);
  const orgRoles = allRoles.filter((r) => r.programId === null);
  const orgReviews = allReviews.filter((r) => r.programId === null);
  const pendingPrograms = allReviews.filter((r) => r.status === "pending" && r.programId !== null);
  const credentials = await listRoleCredentialOptions(ctx, null, orgRoles.flatMap((r) => r.requiredCredentialIds));

  const tabs = [
    { key: "org", label: "Org-wide roles", href: "/admin/volunteer-roles" },
    { key: "programs", label: "All programs", href: "/admin/volunteer-roles?tab=programs" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Volunteer roles</h1>
        <p className="mt-1 text-sm text-stone-500">
          Manage org-wide roles and keep an eye on every program&apos;s roles and sign-ups.
        </p>
      </div>

      <Card data-testid="pending-queue">
        <CardHeader title="Program sign-ups waiting for approval" description="Across all programs. Program admins can also approve their own." />
        <SignupsPanel
          rows={pendingPrograms}
          showProgram
          actions={actions}
          emptyTitle="Nothing waiting for approval"
          emptyDescription="New program sign-ups that need approval will show up here."
        />
      </Card>

      <nav aria-label="Sections" className="flex gap-1 rounded-full border border-line bg-white p-1 text-sm font-semibold shadow-sm w-fit max-w-full overflow-x-auto">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={active === t.key ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-2",
              active === t.key ? "bg-charcoal text-white" : "text-stone-600 hover:bg-alabaster"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {active === "org" ? (
        <RolesManager
          programId={null}
          roles={orgRoles}
          reviews={orgReviews}
          credentials={credentials}
          terms={{ seasonsByProgram: {}, currentYear: termOptions.currentYear }}
          canManage
          isBoard
          actions={actions}
          scopeLabel="the whole organization"
        />
      ) : (
        <ProgramsOverview roles={allRoles} reviews={allReviews} />
      )}
    </div>
  );
}
