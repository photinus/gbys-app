import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MyRoleCard } from "@/components/my-roles/my-role-card";
import { ProgramFilter } from "@/components/my-roles/program-filter";
import { RoleCard } from "@/components/my-roles/role-card";
import { requireSession } from "@/lib/dal/context";
import { listMyAssignments, listOpenRoles } from "@/lib/dal/volunteer-role-signups";

export const metadata: Metadata = { title: "Volunteer Roles" };

export default async function VolunteerRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
}) {
  const ctx = await requireSession("/volunteer/roles");
  const { program = "all" } = await searchParams;
  const [mine, roles] = await Promise.all([listMyAssignments(ctx), listOpenRoles(ctx)]);

  const programOptions = [
    ...new Map(
      roles.filter((r) => r.programId && r.programName).map((r) => [r.programId as string, r.programName as string])
    ).entries(),
  ].map(([id, name]) => ({ id, name }));
  const filter = program === "org" || programOptions.some((p) => p.id === program) ? program : "all";
  const shown = roles.filter((r) =>
    filter === "all" ? true : filter === "org" ? r.programId === null : r.programId === filter
  );

  const live = mine.filter((a) => a.isLive);
  const history = mine.filter((a) => !a.isLive);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Volunteer roles</h1>
        <p className="mt-1 text-sm text-stone-500">
          Roles are the jobs that keep our programs running, like coach, coordinator or concessions lead.
          Sign up for one, then log your hours against it so we can show funders what our volunteers deliver.
        </p>
      </div>

      <Card>
        <CardHeader title="My roles" description="Verified hours are the ones a board member has approved." />
        {mine.length === 0 ? (
          <EmptyState title="No roles yet" description="Find a role below and sign up to get started." />
        ) : (
          <div className="space-y-4">
            {live.length > 0 ? (
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {live.map((a) => (
                  <MyRoleCard key={a.id} a={a} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">You have no current roles.</p>
            )}
            {history.length > 0 ? (
              <details className="rounded-2xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-semibold text-stone-600">
                  Past roles and requests ({history.length})
                </summary>
                <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {history.map((a) => (
                    <MyRoleCard key={a.id} a={a} />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </Card>

      <Card id="find">
        <CardHeader
          title="Find a role"
          description="Pick a role and a term, then sign up or send a request."
        />
        <div className="space-y-4">
          <ProgramFilter options={programOptions} value={filter} />
          {shown.length === 0 ? (
            <EmptyState title="No roles available" description="There are no open volunteer roles here right now." />
          ) : (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {shown.map((r) => (
                <RoleCard key={r.id} role={r} />
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
