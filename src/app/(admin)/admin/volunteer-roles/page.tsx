import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, Select, buttonStyles } from "@/components/ui";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { ProgramsOverview } from "@/components/volunteer-roles/programs-overview";
import { RolesManager } from "@/components/volunteer-roles/roles-manager";
import { SignupsPanel } from "@/components/volunteer-roles/signups-panel";
import type { RoleActions } from "@/components/volunteer-roles/types";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import {
  getProgramForRoles,
  getRoleTermOptions,
  listAssignmentsForReview,
  listManagedRoles,
  listRoleCredentialOptions,
} from "@/lib/dal/volunteer-roles";
import { listProgramsAdmin } from "@/lib/dal/programs";
import { cn } from "@/lib/utils";
import {
  approveAction,
  archiveRoleAction,
  assignAction,
  createProgramRoleAction,
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

async function loadSelectedProgram(ctx: Awaited<ReturnType<typeof requireSession>>, slug: string) {
  const { program, canManage } = await getProgramForRoles(ctx, slug);
  const scope = { programId: program.id };
  const [roles, reviews, termOptions] = await Promise.all([
    listManagedRoles(ctx, scope),
    listAssignmentsForReview(ctx, { scope }),
    getRoleTermOptions(ctx, program.id),
  ]);
  const credentials = await listRoleCredentialOptions(ctx, program.id, roles.flatMap((r) => r.requiredCredentialIds));
  return { program, canManage, roles, reviews, termOptions, credentials };
}

export default async function AdminVolunteerRolesPage({ searchParams }: { searchParams: Promise<{ tab?: string; program?: string }> }) {
  const ctx = await requireSession("/admin/volunteer-roles");
  if (!isBoard(ctx)) notFound();
  const { tab, program: programSlug } = await searchParams;
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

  // "All programs" tab: optionally manage one program's roles with the same manager used on its hub.
  const allPrograms = active === "programs" ? await listProgramsAdmin(ctx) : [];
  let selected: Awaited<ReturnType<typeof loadSelectedProgram>> | null = null;
  if (active === "programs" && programSlug) {
    try {
      selected = await loadSelectedProgram(ctx, programSlug);
    } catch (e) {
      if (!(e instanceof DalError)) throw e;
    }
  }

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
        <>
          <Card data-testid="program-selector">
            <form method="get" action="/admin/volunteer-roles" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="tab" value="programs" />
              <div className="min-w-0 flex-1">
                <label htmlFor="program-select" className="mb-1.5 block text-xs font-semibold text-stone-500">
                  Manage a program&apos;s roles
                </label>
                <Select id="program-select" name="program" defaultValue={selected?.program.slug ?? ""}>
                  <option value="">All programs (overview)</option>
                  {allPrograms.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                      {p.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
                </Select>
              </div>
              <button type="submit" className={buttonStyles({ variant: "secondary" })}>
                Show
              </button>
            </form>
            {programSlug && !selected ? <p className="mt-3 text-sm text-red-700">That program wasn&apos;t found.</p> : null}
          </Card>
          {selected ? (
            <div className="space-y-4" data-testid="selected-program">
              {!selected.program.isActive ? <InactiveProgramBanner /> : null}
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-bold tracking-tight text-charcoal">{selected.program.name}</h2>
                <Badge tone={selected.program.isActive ? "success" : "neutral"}>{selected.program.isActive ? "Active" : "Inactive"}</Badge>
                <Link href={`/programs/${selected.program.slug}`} className="text-xs font-semibold text-indigo-700 hover:underline">
                  Program hub
                </Link>
              </div>
              <RolesManager
                programId={selected.program.id}
                roles={selected.roles}
                reviews={selected.reviews}
                credentials={selected.credentials}
                terms={{ seasonsByProgram: { [selected.program.id]: selected.termOptions.seasons }, currentYear: selected.termOptions.currentYear }}
                canManage={selected.canManage}
                isBoard
                actions={{ ...actions, create: createProgramRoleAction }}
                scopeLabel={selected.program.name}
              />
            </div>
          ) : (
            <ProgramsOverview roles={allRoles} reviews={allReviews} />
          )}
        </>
      )}
    </div>
  );
}
