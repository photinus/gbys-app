import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { HoursKpis } from "@/components/hours/hours-kpis";
import { LogHoursForm } from "@/components/hours/log-hours-form";
import { MyLedger } from "@/components/hours/my-ledger";
import { requireSession } from "@/lib/dal/context";
import { listActivePrograms } from "@/lib/dal/programs";
import { getMyHoursSummary, listMyHours } from "@/lib/dal/volunteer-hours";
import { allowedDateRange } from "@/lib/validation/hours";

export const metadata: Metadata = { title: "My Hours" };

export default async function MyHoursPage() {
  const ctx = await requireSession("/volunteer/hours");
  const [programs, summary, ledger] = await Promise.all([
    listActivePrograms(ctx),
    getMyHoursSummary(ctx),
    listMyHours(ctx),
  ]);
  const { min, max } = allowedDateRange();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My volunteer hours</h1>
        <p className="mt-1 text-sm text-stone-500">
          Log ad-hoc coaching, board and prep time. A board member reviews each entry before it counts
          toward grant reports. Shift check-ins are added automatically.
        </p>
      </div>

      <HoursKpis summary={summary} />

      <Card>
        <CardHeader title="Log hours" description="Takes about 30 seconds." />
        <LogHoursForm programs={programs.map((p) => ({ id: p.id, name: p.name }))} today={max} minDate={min} />
      </Card>

      <Card>
        <CardHeader title={`My ledger (${ledger.year})`} description="Newest first. Pending entries can be withdrawn." />
        <MyLedger entries={ledger.entries} rejected={ledger.rejected} />
      </Card>
    </div>
  );
}
