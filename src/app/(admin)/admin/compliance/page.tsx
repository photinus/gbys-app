import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { ComplianceKpis } from "@/components/compliance/compliance-kpis";
import { VerificationQueueTable } from "@/components/compliance/verification-queue-table";
import { getComplianceSummary, listVerificationQueue } from "@/lib/dal/compliance";
import { isBoard, requireSession } from "@/lib/dal/context";
import { queueFilterSchema, type QueueFilter } from "@/lib/validation/compliance";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Compliance" };

const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending_review", label: "Pending" },
  { value: "verified", label: "Verified" },
  { value: "expiring", label: "Expiring" },
  { value: "expired", label: "Expired" },
  { value: "rejected", label: "Rejected" },
];

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const ctx = await requireSession("/admin/compliance");
  if (!isBoard(ctx)) notFound();

  const { status } = await searchParams;
  const parsed = queueFilterSchema.safeParse(Array.isArray(status) ? status[0] : status);
  const filter: QueueFilter = parsed.success ? parsed.data : "pending_review";

  const [summary, rows] = await Promise.all([
    getComplianceSummary(ctx),
    listVerificationQueue(ctx, filter),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Compliance queue</h1>
        <p className="mt-1 text-sm text-stone-500">
          Review volunteer clearances and certifications. Proof views and decisions are audited.
        </p>
      </div>

      <ComplianceKpis summary={summary} />

      <Card>
        <CardHeader
          title="Credential verification"
          description="First Advantage partner clearances, SafeSport and concussion certificates"
          action={
            <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-line/70 bg-alabaster p-1">
              {FILTERS.map((f) => (
                <Link
                  key={f.value}
                  href={`/admin/compliance?status=${f.value}`}
                  aria-current={f.value === filter ? "true" : undefined}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs transition-all",
                    f.value === filter
                      ? "bg-charcoal font-semibold text-white"
                      : "font-medium text-stone-600 hover:text-charcoal",
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </div>
          }
        />
        <VerificationQueueTable rows={rows} currentUserId={ctx.userId} />
      </Card>
    </div>
  );
}
