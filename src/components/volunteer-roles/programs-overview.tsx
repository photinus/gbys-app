import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import type { ManagedRole, ReviewRow } from "@/lib/dal/volunteer-roles";
import { formatHours } from "@/lib/format";
import { PROGRAM_ROLE_LABELS } from "@/lib/validation/programs";
import { PERIOD_LABELS } from "@/lib/volunteer-roles";

/** Read-only board overview of every program's roles and who holds them. */
export function ProgramsOverview({ roles, reviews }: { roles: ManagedRole[]; reviews: ReviewRow[] }) {
  const programRoles = roles.filter((r) => r.programId);
  if (programRoles.length === 0) {
    return <EmptyState title="No program roles yet" description="Program admins create roles from their program page." />;
  }
  const groups = new Map<string, { name: string; slug: string; roles: ManagedRole[] }>();
  for (const r of programRoles) {
    const g = groups.get(r.programId as string) ?? { name: r.programName ?? "Program", slug: r.programSlug ?? "", roles: [] };
    g.roles.push(r);
    groups.set(r.programId as string, g);
  }
  const activeByRole = new Map<string, string[]>();
  for (const a of reviews) {
    if (a.status !== "active") continue;
    activeByRole.set(a.roleId, [...(activeByRole.get(a.roleId) ?? []), a.userName]);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([id, g]) => (
        <Card key={id} data-testid="program-overview">
          <CardHeader
            title={g.name}
            action={
              <Link href={`/programs/${g.slug}/roles`} className="text-xs font-semibold text-indigo-700 hover:underline">
                Manage roles
              </Link>
            }
          />
          <ul className="divide-y divide-line-soft">
            {g.roles.map((r) => {
              const names = activeByRole.get(r.id) ?? [];
              return (
                <li key={r.id} className={`flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between ${r.isActive ? "" : "opacity-60"}`}>
                  <div className="min-w-0">
                    <p className="font-semibold text-charcoal">
                      {r.name}
                      {!r.isActive ? <span className="ml-2 text-xs font-semibold text-stone-400">(archived)</span> : null}
                    </p>
                    <p className="text-xs text-stone-500">
                      {formatHours(r.expectedMinutes)} {PERIOD_LABELS[r.period].toLowerCase()} · {r.activeCount} active
                      {r.slots !== null ? ` · ${r.slotsUsed} of ${r.slots} slots` : ""}
                    </p>
                    {names.length ? (
                      <p className="mt-0.5 text-xs text-stone-400">
                        {names.slice(0, 8).join(", ")}
                        {names.length > 8 ? ` and ${names.length - 8} more` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.pendingCount > 0 ? <Badge tone="warning">{r.pendingCount} pending</Badge> : null}
                    {r.grantsProgramRole ? <Badge tone="warning">{PROGRAM_ROLE_LABELS[r.grantsProgramRole]} access</Badge> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
