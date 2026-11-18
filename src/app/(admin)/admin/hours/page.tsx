import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { LogForVolunteerModal } from "@/components/hours/log-for-volunteer-modal";
import { ReviewQueue } from "@/components/hours/review-queue";
import { isBoard, requireSession } from "@/lib/dal/context";
import { listActivePrograms } from "@/lib/dal/programs";
import { listPendingHours } from "@/lib/dal/volunteer-hours";
import { allowedDateRange } from "@/lib/validation/hours";

export const metadata: Metadata = { title: "Hours Review" };

export default async function AdminHoursPage() {
  const ctx = await requireSession("/admin/hours");
  if (!isBoard(ctx)) notFound();

  const [rows, programs] = await Promise.all([listPendingHours(ctx), listActivePrograms(ctx)]);
  const { min, max } = allowedDateRange();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Hours review</h1>
        <p className="mt-1 text-sm text-stone-500">
          Approve or reject self-reported volunteer hours. Approved hours count toward grant reports.
          Decisions are audited and the ledger is never edited.
        </p>
      </div>
      <Card>
        <CardHeader
          title={`Pending entries (${rows.length})`}
          description="Oldest first. You cannot approve your own entries."
          action={
            <LogForVolunteerModal
              programs={programs.map((p) => ({ id: p.id, name: p.name }))}
              today={max}
              minDate={min}
            />
          }
        />
        <ReviewQueue rows={rows} />
      </Card>
    </div>
  );
}
