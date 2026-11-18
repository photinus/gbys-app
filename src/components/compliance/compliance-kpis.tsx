import { AlertTriangle, Clock, ShieldCheck, XCircle } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import type { ComplianceSummary } from "@/lib/dal/compliance";

export function ComplianceKpis({ summary }: { summary: ComplianceSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard icon={<Clock className="w-5 h-5" />} label="Pending review" value={summary.pending} hint="Awaiting a board decision" tone="periwinkle" />
      <KpiCard icon={<ShieldCheck className="w-5 h-5" />} label="Verified" value={summary.verified} hint="Currently valid credentials" tone="sage" />
      <KpiCard icon={<AlertTriangle className="w-5 h-5" />} label="Expiring in 30 days" value={summary.expiringIn30} hint="Reminder to renew" tone="amber" />
      <KpiCard icon={<XCircle className="w-5 h-5" />} label="Expired" value={summary.expired} hint="Need a new submission" tone="coral" />
    </div>
  );
}
