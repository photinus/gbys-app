import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { AttentionCard } from "@/components/admin/attention-card";
import { OverviewKpis } from "@/components/admin/overview-kpis";
import { OverviewSide } from "@/components/admin/overview-side";
import { buttonStyles } from "@/components/ui/button";
import { getAdminOverview } from "@/lib/dal/admin-overview";
import { isBoard, requireSession } from "@/lib/dal/context";
import { getBranding } from "@/lib/dal/settings";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Admin overview" };
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const ctx = await requireSession("/admin");
  if (!isBoard(ctx)) notFound();

  const [overview, branding] = await Promise.all([getAdminOverview(ctx), getBranding()]);
  const firstName = ctx.name.trim().split(/\s+/)[0] || "there";

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-charcoal sm:text-3xl">Welcome back, {firstName}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-500">
            <span>Admin Overview</span>
            <span className="text-stone-300">•</span>
            <span className="font-medium text-stone-700">
              {branding.orgName} ({branding.legalDesignation})
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/admin/compliance" className={buttonStyles({ variant: "primary" })}>
            Review credentials
          </Link>
          <Link href="/admin/hours" className={buttonStyles({ variant: "secondary" })}>
            Review hours
          </Link>
          <div className="hidden items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-sm font-medium text-stone-700 sm:inline-flex">
            <CalendarDays className="h-4 w-4 text-stone-400" />
            {formatDate(overview.now)}
          </div>
        </div>
      </section>

      <OverviewKpis kpis={overview.kpis} year={overview.year} />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <AttentionCard a={overview.attention} />
        </div>
        <aside className="xl:col-span-4">
          <OverviewSide o={overview} />
        </aside>
      </div>
    </div>
  );
}
