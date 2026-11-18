import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { AttendanceForm } from "@/components/board/attendance-form";
import { MeetingControls } from "@/components/board/meeting-controls";
import { MeetingStatusBadge, MeetingSummary } from "@/components/board/meeting-summary";
import { MinutesPanel } from "@/components/board/minutes-panel";
import { Badge, Card, CardHeader, buttonStyles } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getMeeting } from "@/lib/dal/board-meetings";

export const metadata: Metadata = { title: "Board meeting" };
export const dynamic = "force-dynamic";

export default async function BoardMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/admin/board/meetings/${id}`);
  let detail;
  try {
    detail = await getMeeting(ctx, id);
  } catch (e) {
    if (e instanceof DalError && (e.code === "NOT_FOUND" || e.code === "INVALID")) notFound();
    throw e;
  }
  const { meeting, seats, minutes } = detail;
  const cancelled = meeting.status === "cancelled";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/board/meetings" className="text-xs font-semibold text-indigo-700 hover:underline">
          All meetings
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{meeting.title}</h1>
          <MeetingStatusBadge status={meeting.status} />
          {meeting.isPublic ? <Badge tone="info">Visible to members</Badge> : <Badge>Board only</Badge>}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Details"
          action={
            <>
              <a href={`/admin/board/meetings/${meeting.id}/ics`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
                <Download className="h-4 w-4" aria-hidden /> Add to calendar
              </a>
              <Link href="/admin/board/motions" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Motions and votes
              </Link>
            </>
          }
        />
        <div className="space-y-4">
          <MeetingSummary meeting={meeting} />
          <MeetingControls
            meeting={{
              id: meeting.id,
              title: meeting.title,
              kind: meeting.kind,
              startsAt: meeting.startsAt,
              endsAt: meeting.endsAt,
              location: meeting.location,
              virtualUrl: meeting.virtualUrl,
              agenda: meeting.agenda,
              isPublic: meeting.isPublic,
            }}
            status={meeting.status}
            canMarkHeld={meeting.startsAt.getTime() <= Date.now()}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Attendance" description="Voting directors whose seat covered the meeting start. Quorum for motions is taken from this." />
        <AttendanceForm meetingId={meeting.id} seats={seats} disabled={cancelled} />
      </Card>

      <Card>
        <CardHeader title="Minutes" description="Drafts can be edited. Approved minutes are permanent; corrections become a new version." />
        <MinutesPanel meetingId={meeting.id} minutes={minutes} disabled={cancelled} />
      </Card>
    </div>
  );
}
