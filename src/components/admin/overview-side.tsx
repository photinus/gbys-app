import Link from "next/link";
import { ArrowUpRight, CalendarDays, Download } from "lucide-react";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PastelCard } from "@/components/ui/pastel-card";
import type { AdminOverview } from "@/lib/dal/admin-overview";
import { formatCents, formatDate, formatDateTime, formatHours } from "@/lib/format";

const pill =
  "inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-700 shadow-2xs";

export function OverviewSide({ o }: { o: AdminOverview }) {
  const { upcomingShifts: shifts, openSeasons, volunteerRoles: roles } = o;
  const more = shifts.count - shifts.next.length;
  return (
    <Card className="space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-charcoal">Coming up</h2>
        <Link
          href="/admin/programs"
          title="All programs"
          aria-label="All programs"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-alabaster text-charcoal transition-colors hover:bg-stone-200/70"
        >
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <PastelCard
        tone="lavender"
        title="Volunteer roles"
        action={
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-indigo-900">
            {roles.activeAssignments.toLocaleString("en-US")} active
          </span>
        }
      >
        <ul className="space-y-1.5">
          <li className="flex items-center justify-between gap-2">
            <span>Pending approvals</span>
            <Link href="/admin/volunteer-roles" className={`${pill} shrink-0`}>
              {roles.pendingApprovals.toLocaleString("en-US")}
            </Link>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>Verified vs expected hours ({o.year})</span>
            <span className={`${pill} shrink-0`}>
              {formatHours(roles.verifiedMinutes)} / {formatHours(roles.expectedMinutes)}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>Fulfilment</span>
            <span className={`${pill} shrink-0`}>
              {roles.fulfilmentPercent === null ? "n/a" : `${roles.fulfilmentPercent}%`}
            </span>
          </li>
        </ul>
        <div className="mt-3 flex justify-end">
          <Link href="/admin/volunteer-roles" className="text-xs font-bold text-charcoal underline underline-offset-2">
            Manage volunteer roles →
          </Link>
        </div>
      </PastelCard>

      {o.shiftsEnabled ? (
      <PastelCard
        tone="lavender"
        title="Upcoming shifts (next 7 days)"
        action={
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-indigo-900">
            {shifts.count.toLocaleString("en-US")}
          </span>
        }
      >
        {shifts.next.length === 0 ? (
          <p>No volunteer shifts scheduled this week.</p>
        ) : (
          <ul className="space-y-2">
            {shifts.next.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-charcoal">{s.title}</p>
                  <p className="text-stone-500">
                    {formatDateTime(s.startsAt)}
                    {s.programName ? ` · ${s.programName}` : " · Org-wide"}
                  </p>
                </div>
                <span className={`${pill} shrink-0`}>
                  {s.spotsFilled}/{s.spotsTotal}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-stone-500">{more > 0 ? `+${more} more this week` : " "}</span>
          <Link href="/volunteer/shifts/manage" className="text-xs font-bold text-charcoal underline underline-offset-2">
            Manage shifts →
          </Link>
        </div>
      </PastelCard>
      ) : null}

      <PastelCard
        tone="peach"
        title="Open registrations"
        action={
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
            {openSeasons.length} open
          </span>
        }
      >
        {openSeasons.length === 0 ? (
          <p>No seasons are accepting registrations.</p>
        ) : (
          <ul className="space-y-2">
            {openSeasons.map((s) => (
              <li key={s.id}>
                <Link href={`/admin/programs/${s.programId}`} className="flex items-start justify-between gap-2 hover:opacity-80">
                  <div className="min-w-0">
                    <p className="font-semibold text-charcoal">
                      {s.programName} · {s.name}
                    </p>
                    <p className="flex items-center gap-1 text-stone-500">
                      <CalendarDays className="h-3 w-3 shrink-0" />
                      {s.registrationClosesAt ? `Closes ${formatDate(s.registrationClosesAt)}` : "No closing date"}
                    </p>
                  </div>
                  <span className={`${pill} shrink-0`}>
                    {s.registrations.toLocaleString("en-US")} {s.registrations === 1 ? "athlete" : "athletes"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PastelCard>

      <PastelCard tone="mint" title="Grant report ready">
        <p>
          {o.year} verified volunteer hours (
          <span className="font-semibold text-charcoal">{formatHours(o.kpis.ytdMinutes)}</span>) and{" "}
          <span className="font-semibold text-charcoal">{formatCents(o.kpis.ytdValueCents)}</span> in-kind match valuation.
        </p>
        <Link href="/admin/grants" className={buttonStyles({ size: "sm", className: "mt-3 w-full" })}>
          <Download className="h-3.5 w-3.5" />
          Open grant reports
        </Link>
      </PastelCard>
    </Card>
  );
}
