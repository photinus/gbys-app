import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarCheck, Clock, ShieldCheck, Users } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { PastelCard } from "@/components/ui/pastel-card";
import { requireSession } from "@/lib/dal/context";
import { getMyHoursSummary } from "@/lib/dal/volunteer-hours";
import { getMyRolesSummary } from "@/lib/dal/volunteer-role-signups";
import { isFeatureEnabled } from "@/lib/features";
import { formatHours } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Los_Angeles",
    }).format(new Date()),
  ) % 24;
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const ctx = await requireSession("/dashboard");
  const [hours, roles] = await Promise.all([getMyHoursSummary(ctx), getMyRolesSummary(ctx)]);
  const shiftsOn = isFeatureEnabled("volunteerShifts");
  const firstName = ctx.name.trim().split(/\s+/)[0] || ctx.email.split("@")[0] || "there";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-stone-500">Here&apos;s a quick way to get to what you need.</p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/household" className="block rounded-[24px] focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/60">
          <KpiCard
            icon={<Users className="w-5 h-5" />}
            label="Household"
            value="My athletes"
            hint="Manage athletes, emergency contacts and co-guardians"
            tone="periwinkle"
            className="h-full"
          />
        </Link>
        <Link href="/volunteer/credentials" className="block rounded-[24px] focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/60">
          <KpiCard
            icon={<ShieldCheck className="w-5 h-5" />}
            label="Volunteer credentials"
            value="My credentials"
            hint="Upload background checks and certifications"
            tone="sage"
            className="h-full"
          />
        </Link>
        <Link href="/volunteer/hours" className="block rounded-[24px] focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/60">
          <KpiCard
            icon={<Clock className="w-5 h-5" />}
            label="My volunteer hours (YTD)"
            value={formatHours(hours.verifiedMinutes)}
            hint={
              hours.pendingMinutes > 0
                ? `Verified in ${hours.year}. ${formatHours(hours.pendingMinutes)} pending review`
                : `Verified in ${hours.year}. Log or review your hours`
            }
            tone="amber"
            className="h-full"
          />
        </Link>
        <Link href="/volunteer/roles" className="block rounded-[24px] focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/60" data-testid="dash-roles">
          <KpiCard
            icon={<BadgeCheck className="w-5 h-5" />}
            label="My volunteer roles"
            value={roles.activeCount === 0 ? "No roles yet" : `${roles.activeCount} active ${roles.activeCount === 1 ? "role" : "roles"}`}
            hint={
              roles.activeCount === 0
                ? roles.pendingCount > 0
                  ? `${roles.pendingCount} ${roles.pendingCount === 1 ? "request" : "requests"} waiting for approval`
                  : "Find a role to sign up for"
                : `${formatHours(roles.verifiedMinutes)} of ${formatHours(roles.expectedMinutes)} expected logged${
                    roles.pendingCount > 0 ? `. ${roles.pendingCount} role ${roles.pendingCount === 1 ? "request" : "requests"} waiting for approval` : ""
                  }`
            }
            tone="coral"
            className="h-full"
          />
        </Link>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-stone-400">Quick links</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PastelCard
            tone="lavender"
            title="Add or update your athletes"
            action={
              <Link href="/household" aria-label="Go to household" className="text-indigo-700 hover:text-indigo-900">
                <ArrowRight className="h-4 w-4" />
              </Link>
            }
          >
            Keep emergency contacts and medical notes current, and invite another guardian to share access.
          </PastelCard>
          <PastelCard
            tone="mint"
            title="Submit a volunteer credential"
            action={
              <Link href="/volunteer/credentials" aria-label="Go to credentials" className="text-emerald-800 hover:text-emerald-950">
                <ArrowRight className="h-4 w-4" />
              </Link>
            }
          >
            Coaches and volunteers: upload proof of your background check, SafeSport and concussion training.
          </PastelCard>
          <PastelCard
            tone="peach"
            title="Find a volunteer role"
            action={
              <Link href="/volunteer/roles" aria-label="Find a volunteer role" className="text-amber-800 hover:text-amber-950">
                <ArrowRight className="h-4 w-4" />
              </Link>
            }
          >
            Coach, coordinate or help run a program. Sign up for a role, then log your hours against it.
          </PastelCard>
          {shiftsOn ? (
            <PastelCard
              tone="lavender"
              title="Sign up for a volunteer shift"
              action={
                <Link href="/volunteer/shifts" aria-label="Go to volunteer shifts" className="text-amber-800 hover:text-amber-950">
                  <CalendarCheck className="h-4 w-4" />
                </Link>
              }
            >
              Pick up an open shift. Hours from shifts you attend are added to your ledger automatically.
            </PastelCard>
          ) : null}
        </div>
      </section>
    </div>
  );
}
