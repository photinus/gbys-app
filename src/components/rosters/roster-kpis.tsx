import { CheckCircle2, CircleDollarSign, Clock, Users } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import type { RosterKpis } from "@/lib/dal/rosters";
import { formatCents } from "@/lib/format";

export function RosterKpiRow({ kpis }: { kpis: RosterKpis }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <KpiCard icon={<Users className="h-5 w-5" />} label="Registered" value={kpis.registered} tone="periwinkle" />
      <KpiCard icon={<CheckCircle2 className="h-5 w-5" />} label="Paid" value={kpis.paid} tone="sage" />
      <KpiCard icon={<Clock className="h-5 w-5" />} label="Unpaid" value={kpis.unpaid} tone="amber" />
      <KpiCard
        icon={<CircleDollarSign className="h-5 w-5" />}
        label="Collected"
        value={formatCents(kpis.collectedCents)}
        tone="coral"
      />
    </div>
  );
}
