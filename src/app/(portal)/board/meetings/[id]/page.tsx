import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Markdown } from "@/components/board/markdown";
import { MeetingSummary } from "@/components/board/meeting-summary";
import { Badge, Card, CardHeader, buttonStyles } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getPublicMeeting } from "@/lib/dal/board-meetings";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Board meeting" };
export const dynamic = "force-dynamic";

export default async function PublicMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/board/meetings/${id}`);
  let data;
  try {
    data = await getPublicMeeting(ctx, id);
  } catch (e) {
    if (e instanceof DalError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { meeting, minutes } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/board" className="text-xs font-semibold text-indigo-700 hover:underline">
          Board meetings
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{meeting.title}</h1>
          {meeting.status === "cancelled" ? <Badge tone="danger">Cancelled</Badge> : null}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Details"
          action={
            <a href={`/board/meetings/${meeting.id}/ics`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
              <Download className="h-4 w-4" aria-hidden /> Add to calendar
            </a>
          }
        />
        <MeetingSummary meeting={meeting} />
      </Card>

      {minutes ? (
        <Card data-testid="public-minutes">
          <CardHeader title="Approved minutes" description={minutes.approvedAt ? `Approved ${formatDate(minutes.approvedAt)}` : undefined} />
          <Markdown source={minutes.body} />
        </Card>
      ) : meeting.status === "held" ? (
        <p className="text-sm text-stone-500">Minutes haven&apos;t been posted for this meeting yet.</p>
      ) : null}
    </div>
  );
}
