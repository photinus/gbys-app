import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Card, CardHeader, EmptyState, Select, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { MotionKindBadge, MotionStatusBadge } from "@/components/board-motions/badges";
import { NewMotionButton } from "@/components/board-motions/new-motion-button";
import type { MotionActions } from "@/components/board-motions/types";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import { listMotionFormOptions, listMotions } from "@/lib/dal/board-motions";
import { formatDateTime } from "@/lib/format";
import {
  KIND_LABELS,
  MOTION_KINDS,
  MOTION_STATUSES,
  STATUS_LABELS,
  THRESHOLD_LABELS,
  type MotionKind,
  type MotionStatus,
} from "@/lib/validation/board-motions";
import { closeMotionAction, createMotionAction, openMotionAction, rollCallAction, updateMotionAction, withdrawMotionAction } from "./actions";

export const metadata: Metadata = { title: "Board motions" };

const actions: MotionActions = {
  create: createMotionAction,
  update: updateMotionAction,
  open: openMotionAction,
  close: closeMotionAction,
  withdraw: withdrawMotionAction,
  rollCall: rollCallAction,
};

export default async function AdminMotionsPage({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string; meeting?: string; new?: string }> }) {
  const ctx = await requireSession("/admin/board/motions");
  if (!isBoard(ctx)) notFound();
  const sp = await searchParams;
  const status = (MOTION_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as MotionStatus) : undefined;
  const kind = (MOTION_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as MotionKind) : undefined;

  let motions, options;
  try {
    [motions, options] = await Promise.all([listMotions(ctx, { status, kind, meetingId: sp.meeting }), listMotionFormOptions(ctx)]);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const meetingId = sp.meeting && options.meetings.some((m) => m.id === sp.meeting) ? sp.meeting : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Board motions</h1>
          <p className="mt-1 text-sm text-stone-500">
            Motions made in a meeting and actions taken without a meeting. Votes are recorded permanently.{" "}
            <Link href="/admin/board" className="font-semibold text-charcoal underline underline-offset-2">
              Board overview
            </Link>
          </p>
        </div>
        <NewMotionButton options={options} actions={actions} defaultMeetingId={meetingId} autoOpen={sp.new === "1"} />
      </div>

      <Card>
        <CardHeader
          title="All motions"
          action={
            <form method="get" action="/admin/board/motions" className="flex flex-wrap items-end gap-2" data-testid="motion-filters">
              {meetingId ? <input type="hidden" name="meeting" value={meetingId} /> : null}
              <div className="w-44">
                <label htmlFor="f-status" className="sr-only">Status</label>
                <Select id="f-status" name="status" defaultValue={status ?? ""}>
                  <option value="">All statuses</option>
                  {MOTION_STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </Select>
              </div>
              <div className="w-52">
                <label htmlFor="f-kind" className="sr-only">Kind</label>
                <Select id="f-kind" name="kind" defaultValue={kind ?? ""}>
                  <option value="">All kinds</option>
                  {MOTION_KINDS.map((k) => (
                    <option key={k} value={k}>{KIND_LABELS[k]}</option>
                  ))}
                </Select>
              </div>
              <Button type="submit" variant="secondary">Filter</Button>
            </form>
          }
        />
        {motions.length === 0 ? (
          <EmptyState title="No motions" description={status || kind ? "No motions match these filters." : "Create a draft motion to get started."} />
        ) : (
          <Table className="min-w-[760px]">
            <THead>
              <tr>
                <TH className="pl-2">Motion</TH>
                <TH>Status</TH>
                <TH>Threshold</TH>
                <TH>Votes</TH>
                <TH className="pr-2">Voting</TH>
              </tr>
            </THead>
            <TBody>
              {motions.map((m) => (
                <TR key={m.id} data-testid="motion-row">
                  <TD className="pl-2">
                    <Link href={`/admin/board/motions/${m.id}`} className="font-semibold text-charcoal hover:underline">
                      {m.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                      <MotionKindBadge kind={m.kind} />
                      {m.meetingTitle ? <span>{m.meetingTitle}</span> : null}
                    </div>
                  </TD>
                  <TD><MotionStatusBadge status={m.status} /></TD>
                  <TD className="text-xs text-stone-600">{THRESHOLD_LABELS[m.threshold]}</TD>
                  <TD className="whitespace-nowrap text-charcoal">
                    {m.votesCast}
                    {m.status !== "draft" && m.status !== "withdrawn" ? ` of ${m.eligibleCount}` : ""}
                  </TD>
                  <TD className="pr-2 text-xs text-stone-600">
                    {m.status === "draft" ? (
                      "Not opened"
                    ) : m.status === "open" ? (
                      m.closesAt ? `Closes ${formatDateTime(m.closesAt)}` : "Open until closed by the board"
                    ) : m.closedAt ? (
                      `Closed ${formatDateTime(m.closedAt)}`
                    ) : (
                      "—"
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
