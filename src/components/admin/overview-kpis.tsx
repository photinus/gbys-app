import { CheckCircle2, Clock, Globe2, Users } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import type { AdminOverview } from "@/lib/dal/admin-overview";
import { formatCents, formatHours } from "@/lib/format";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function OverviewKpis({ kpis, year }: { kpis: AdminOverview["kpis"]; year: number }) {
  return (
    <section aria-label="Key numbers" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={<Users className="h-5 w-5" />}
        tone="periwinkle"
        label="Active Volunteers"
        value={kpis.activeVolunteers.toLocaleString("en-US")}
        delta={kpis.verifiedThisMonth > 0 ? `+${kpis.verifiedThisMonth} this month` : undefined}
        hint="With a verified, unexpired credential"
      />
      <KpiCard
        icon={<CheckCircle2 className="h-5 w-5" />}
        tone="sage"
        label="Registered Athletes"
        value={kpis.registeredAthletes.toLocaleString("en-US")}
        hint={`${plural(kpis.activeRegistrations, "registration")} across ${plural(kpis.activeSeasons, "active season")}`}
      />
      <KpiCard
        icon={<Clock className="h-5 w-5" />}
        tone="coral"
        label={`Volunteer Hours (${year} YTD)`}
        value={formatHours(kpis.ytdMinutes)}
        delta={`${formatCents(kpis.ytdValueCents)} value`}
        hint={`Verified ledger entries · current rate ${formatCents(kpis.currentRateCents)}/hr`}
      />
      <KpiCard
        icon={<Globe2 className="h-5 w-5" />}
        tone="amber"
        label="Partner Leagues"
        value={kpis.partnerLeagues.toLocaleString("en-US")}
        hint={kpis.partnerLeagueNames.length ? kpis.partnerLeagueNames.join(", ") : "No active independent partners"}
      />
    </section>
  );
}
