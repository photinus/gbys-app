import type { Metadata } from "next";
import {
  AttentionSection,
  DuesSection,
  HouseholdSection,
  RegistrationsSection,
  RolesSection,
} from "@/components/dashboard/dashboard-sections";
import { QuickLinkCard } from "@/components/dashboard/quick-link-card";
import { requireSession } from "@/lib/dal/context";
import { getMemberDashboard } from "@/lib/dal/dashboard";
import { isFeatureEnabled } from "@/lib/features";

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
  const data = await getMemberDashboard(ctx);
  const shiftsOn = isFeatureEnabled("volunteerShifts");
  const firstName = ctx.name.trim().split(/\s+/)[0] || ctx.email.split("@")[0] || "there";

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-stone-500">Here&apos;s where things stand for your family.</p>
      </div>

      <AttentionSection items={data.attention} more={data.attentionMore} />

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        <HouseholdSection members={data.household} />
        <RegistrationsSection items={data.registrations} />
        <DuesSection dues={data.dues} />
        <RolesSection roles={data.roles} />
      </div>

      <section aria-labelledby="quick-links">
        <h2 id="quick-links" className="mb-3 text-sm font-bold uppercase tracking-wider text-stone-400">
          Quick links
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <QuickLinkCard href="/household" tone="lavender" title="Add or update your athletes">
            Keep emergency contacts and medical notes current, and invite another parent or guardian to share access.
          </QuickLinkCard>
          <QuickLinkCard href="/volunteer/credentials" tone="mint" title="Submit a volunteer credential">
            Coaches and volunteers: upload proof of your background check, SafeSport and concussion training.
          </QuickLinkCard>
          <QuickLinkCard href="/volunteer/roles" tone="peach" title="Find a volunteer role">
            Coach, coordinate or help run a program. Sign up for a role, then log your hours against it.
          </QuickLinkCard>
          {shiftsOn ? (
            <QuickLinkCard href="/volunteer/shifts" tone="lavender" title="Sign up for a volunteer shift">
              Pick up an open shift. Hours from shifts you attend are added to your ledger automatically.
            </QuickLinkCard>
          ) : null}
        </div>
      </section>
    </div>
  );
}
