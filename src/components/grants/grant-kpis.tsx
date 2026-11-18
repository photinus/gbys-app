import { Clock, DollarSign, ListChecks, Users } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import type { GrantReport } from "@/lib/dal/grants";
import { formatCents, formatHours } from "@/lib/format";

export function GrantKpis({ totals }: { totals: GrantReport["totals"] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard icon={<Clock className="w-5 h-5" />} label="Volunteer hours" value={formatHours(totals.minutes)} hint={`${totals.minutes.toLocaleString("en-US")} minutes`} tone="periwinkle" />
      <KpiCard icon={<DollarSign className="w-5 h-5" />} label="In-kind value" value={formatCents(totals.valueCents)} hint="Sum of per-entry values" tone="sage" />
      <KpiCard icon={<Users className="w-5 h-5" />} label="Volunteers" value={totals.volunteers.toLocaleString("en-US")} hint="Distinct people" tone="amber" />
      <KpiCard icon={<ListChecks className="w-5 h-5" />} label="Entries" value={totals.entries.toLocaleString("en-US")} hint="Ledger rows (equals CSV rows)" tone="coral" />
    </div>
  );
}
