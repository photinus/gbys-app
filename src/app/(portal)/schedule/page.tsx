import type { Metadata } from "next";
import { ParentSchedule } from "@/components/schedule/parent-schedule";
import { appBaseUrl, toEventItem } from "@/components/schedule/serialize";
import { requireSession } from "@/lib/dal/context";
import { listMySchedule } from "@/lib/dal/team-schedule";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";

export const metadata: Metadata = { title: "Schedule" };

export default async function MySchedulePage() {
  const ctx = await requireSession("/schedule");
  const from = laDateInputToUtc(utcToLaDateInput(new Date()), false);
  const to = new Date(from.getTime() + 28 * 86_400_000);
  const my = await listMySchedule(ctx, { from, to });

  const events = my.events.map((e) => ({
    ...toEventItem(e),
    athletes: e.athletes.map((a) => a.name),
    athleteIds: e.athletes.map((a) => a.id),
    staffRole: e.staffRole,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-charcoal">Schedule</h1>
        <p className="mt-1 text-sm text-stone-500">Everything coming up for your family&rsquo;s teams.</p>
      </div>
      <ParentSchedule events={events} teams={my.teams} athletes={my.athletes} baseUrl={appBaseUrl()} />
    </div>
  );
}
