import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DalError, requireSession } from "@/lib/dal/context";
import { getShiftRoster, type ShiftRoster } from "@/lib/dal/shifts";
import { Badge } from "@/components/ui";
import { RosterBoard } from "@/components/shifts/roster-board";
import { formatTimeRange } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/volunteer-categories";

export const metadata = { title: "Shift roster | GBYS" };

export default async function ShiftRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/volunteer/shifts/${id}`);
  let roster: ShiftRoster;
  try {
    roster = await getShiftRoster(ctx, id);
  } catch (err) {
    // Members and unknown ids look the same: no existence leak.
    if (err instanceof DalError && (err.code === "FORBIDDEN" || err.code === "NOT_FOUND")) notFound();
    throw err;
  }
  const { shift, entries } = roster;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Link
        href="/volunteer/shifts/manage"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All shifts
      </Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-charcoal">{shift.title}</h1>
          <Badge tone="info">{CATEGORY_LABELS[shift.category]}</Badge>
        </div>
        <p className="mt-1 text-sm text-stone-500">
          {shift.programName ?? "Organization-wide"} · {formatTimeRange(shift.startsAt, shift.endsAt)}
          {shift.location ? ` · ${shift.location}` : ""}
        </p>
      </div>
      <RosterBoard shift={shift} entries={entries} />
    </div>
  );
}
