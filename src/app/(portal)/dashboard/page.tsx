import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Users } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { PastelCard } from "@/components/ui/pastel-card";
import { requireSession } from "@/lib/dal/context";

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
  const firstName = ctx.name.trim().split(/\s+/)[0] || ctx.email.split("@")[0] || "there";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {greeting()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-stone-500">Here&apos;s a quick way to get to what you need.</p>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>
      </section>
    </div>
  );
}
