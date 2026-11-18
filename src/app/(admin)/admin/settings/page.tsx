import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { LogoCard, ProfileForm, RateForm } from "@/components/settings/settings-forms";
import { isBoard, requireSession } from "@/lib/dal/context";
import { getOrgSettings } from "@/lib/dal/settings";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await requireSession("/admin/settings");
  if (!isBoard(ctx)) notFound();
  const s = await getOrgSettings(ctx);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Organization profile, branding and the volunteer valuation. Every change is audited.
          {s.updatedAt ? ` Last saved ${formatDateTime(s.updatedAt)}${s.updatedByName ? ` by ${s.updatedByName}` : ""}.` : ""}
        </p>
      </div>

      <Card>
        <CardHeader title="Organization profile" description="Shown across the app, on sign-in pages and on grant summaries" />
        <ProfileForm settings={s} />
      </Card>

      <Card>
        <CardHeader title="Branding" description="Your logo appears in the sidebar, on sign-in and on public pages" />
        <LogoCard
          logoUrl={s.logoUrl}
          logoUpdatedAt={s.logoUpdatedAt ? formatDateTime(s.logoUpdatedAt) : null}
        />
      </Card>

      <Card>
        <CardHeader
          title="Volunteer valuation"
          description={`Current rate for new entries: $${(s.effectiveRateCents / 100).toFixed(2)}/hour${s.inKindHourlyRateCents === null ? " (default)" : ""}`}
        />
        <RateForm settings={s} />
      </Card>

      <Link
        href="/admin/settings/credentials"
        className="flex items-center justify-between gap-3 rounded-[26px] border border-line/80 bg-white p-5 shadow-card hover:bg-alabaster/60 sm:p-6"
      >
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-charcoal">Credential types</h2>
          <p className="mt-0.5 text-xs text-stone-500">Background checks, trainings and agreements volunteers submit</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-stone-400" aria-hidden />
      </Link>
    </div>
  );
}
