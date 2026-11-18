import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { isProgramStaff } from "@/lib/dal/permissions";
import { listMyStaffPrograms } from "@/lib/dal/seasons";

export const metadata: Metadata = { title: "My programs" };

export default async function MyProgramsPage() {
  const ctx = await requireSession("/programs");
  if (!isProgramStaff(ctx)) notFound();
  const programs = await listMyStaffPrograms(ctx);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-charcoal">My programs</h1>
        <p className="mt-1 text-sm text-stone-500">Seasons, rosters and emergency sheets for the programs you run or coach.</p>
      </div>
      {programs.length === 0 ? (
        <EmptyState title="No programs yet" description="Programs you coach or administer will appear here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {programs.map((p) => (
            <Link key={p.id} href={`/programs/${p.slug}`} data-testid="program-card" className="group block">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold text-charcoal">{p.name}</h2>
                    <p className="text-xs text-stone-500">{p.sport}</p>
                  </div>
                  <Badge tone={p.canManage ? "info" : "neutral"}>{p.canManage ? "Manager" : "Staff"}</Badge>
                </div>
                {p.description ? <p className="mt-3 line-clamp-2 text-sm text-stone-600">{p.description}</p> : null}
                <dl className="mt-4 flex gap-6 text-sm">
                  <div>
                    <dt className="text-xs text-stone-500">Open seasons</dt>
                    <dd className="text-xl font-bold text-charcoal">{p.openSeasons}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-stone-500">Registrations</dt>
                    <dd className="text-xl font-bold text-charcoal">{p.liveRegistrations}</dd>
                  </div>
                </dl>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
