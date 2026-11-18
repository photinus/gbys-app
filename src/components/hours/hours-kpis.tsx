import { CheckCircle2, Clock, DollarSign } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { formatCents, formatHours } from "@/lib/format";
import type { HoursSummary } from "@/lib/dal/volunteer-hours";

export function HoursKpis({ summary }: { summary: HoursSummary }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label={`Year to date ${summary.year}`}>
      <KpiCard
        icon={<CheckCircle2 className="h-5 w-5" />}
        label={`Verified hours (${summary.year})`}
        value={formatHours(summary.verifiedMinutes)}
        hint="Shift check-ins and approved entries"
        tone="sage"
      />
      <KpiCard
        icon={<DollarSign className="h-5 w-5" />}
        label="In-kind value"
        value={formatCents(summary.verifiedValueCents)}
        hint="Verified hours at the volunteer rate in effect when logged"
        tone="periwinkle"
      />
      <KpiCard
        icon={<Clock className="h-5 w-5" />}
        label="Pending review"
        value={formatHours(summary.pendingMinutes)}
        hint="Self-reported, waiting for a board member"
        tone="amber"
      />
    </section>
  );
}
