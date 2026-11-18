import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal/context";
import { isFeatureEnabled } from "@/lib/features";
import { isShiftCoordinator } from "@/lib/dal/permissions";
import { listManageableShifts, listShiftProgramOptions } from "@/lib/dal/shifts";
import { Card, CardHeader } from "@/components/ui";
import { ManageShiftsTable } from "@/components/shifts/manage-shifts-table";
import { NewShiftButton } from "@/components/shifts/shift-form-modal";

export const metadata = { title: "Manage shifts | GBYS" };

export default async function ManageShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  if (!isFeatureEnabled("volunteerShifts")) notFound();
  const ctx = await requireSession("/volunteer/shifts/manage");
  if (!isShiftCoordinator(ctx)) notFound();
  const { range } = await searchParams;
  const past = range === "past";
  const [shifts, options] = await Promise.all([
    listManageableShifts(ctx, { range: past ? "past" : "upcoming" }),
    listShiftProgramOptions(ctx),
  ]);
  const canCreate = options.canOrgWide || options.programs.length > 0;

  const tab = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-xs font-semibold ${active ? "bg-charcoal text-white" : "bg-white text-stone-600 border border-line"}`;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal">Manage shifts</h1>
          <p className="mt-1 text-sm text-stone-500">
            Create shifts, open the kiosk roster for check-in, and cancel shifts.
          </p>
        </div>
        {canCreate ? <NewShiftButton programs={options.programs} canOrgWide={options.canOrgWide} /> : null}
      </div>
      <Card>
        <CardHeader
          title={past ? "Past shifts" : "Upcoming shifts"}
          action={
            <div className="flex gap-2">
              <Link href="/volunteer/shifts/manage" className={tab(!past)}>
                Upcoming
              </Link>
              <Link href="/volunteer/shifts/manage?range=past" className={tab(past)}>
                Past
              </Link>
            </div>
          }
        />
        <ManageShiftsTable shifts={shifts} programs={options.programs} canOrgWide={options.canOrgWide} past={past} />
      </Card>
    </div>
  );
}
