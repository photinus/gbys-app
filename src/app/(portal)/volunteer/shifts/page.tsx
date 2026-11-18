import Link from "next/link";
import { requireSession } from "@/lib/dal/context";
import { isShiftCoordinator } from "@/lib/dal/permissions";
import { listActivePrograms } from "@/lib/dal/programs";
import { listMyShifts, listUpcomingShifts } from "@/lib/dal/shifts";
import { buttonStyles } from "@/components/ui";
import { MyShifts } from "@/components/shifts/my-shifts";
import { ShiftBrowser } from "@/components/shifts/shift-browser";

export const metadata = { title: "Volunteer shifts | GBYS" };

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
}) {
  const ctx = await requireSession("/volunteer/shifts");
  const { program } = await searchParams;
  const programId = typeof program === "string" ? program : "";
  const [shifts, mine, programs] = await Promise.all([
    listUpcomingShifts(ctx, { programId: programId || undefined }),
    listMyShifts(ctx),
    listActivePrograms(ctx),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-charcoal">Volunteer shifts</h1>
          <p className="mt-1 text-sm text-stone-500">
            Pick a shift to help out. Your hours are logged automatically when you check in.
          </p>
        </div>
        {isShiftCoordinator(ctx) ? (
          <Link href="/volunteer/shifts/manage" className={buttonStyles({ variant: "secondary", size: "sm" })}>
            Manage shifts
          </Link>
        ) : null}
      </div>
      <ShiftBrowser shifts={shifts} programs={programs} selectedProgram={programId} />
      <MyShifts shifts={mine} />
    </div>
  );
}
