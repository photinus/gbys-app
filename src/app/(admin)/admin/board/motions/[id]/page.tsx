import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { MotionKindBadge, MotionStatusBadge } from "@/components/board-motions/badges";
import { MotionControls } from "@/components/board-motions/motion-controls";
import { RollCallRecorder } from "@/components/board-motions/roll-call-recorder";
import type { MotionActions } from "@/components/board-motions/types";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import { getMotion, listMotionFormOptions } from "@/lib/dal/board-motions";
import { formatDateTime, utcToLaDateTimeInput } from "@/lib/format";
import { CHOICE_LABELS, KIND_LABELS, MIN_WRITTEN_CONSENT_HOURS, THRESHOLD_EXPLAINERS, THRESHOLD_LABELS } from "@/lib/validation/board-motions";
import { closeMotionAction, createMotionAction, openMotionAction, rollCallAction, updateMotionAction, withdrawMotionAction } from "../actions";

export const metadata: Metadata = { title: "Board motion" };

const actions: MotionActions = {
  create: createMotionAction,
  update: updateMotionAction,
  open: openMotionAction,
  close: closeMotionAction,
  withdraw: withdrawMotionAction,
  rollCall: rollCallAction,
};

const ATTENDANCE_LABELS = { present: "Present", remote: "Remote", absent: "Absent", excused: "Excused" } as const;

export default async function AdminMotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/admin/board/motions/${id}`);
  if (!isBoard(ctx)) notFound();
  let motion, options;
  try {
    [motion, options] = await Promise.all([getMotion(ctx, id), listMotionFormOptions(ctx)]);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }

  const now = Date.now();
  const defaultClosesAt = utcToLaDateTimeInput(new Date(now + 72 * 3_600_000));
  const minClosesAt = utcToLaDateTimeInput(new Date(now + (MIN_WRITTEN_CONSENT_HOURS + 1) * 3_600_000));
  const showVotes = motion.status !== "draft" && motion.status !== "withdrawn";
  const t = motion.tally;
  const notVoted = t.eligible - t.voted;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/board/motions" className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          ← All motions
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight break-words sm:text-3xl">{motion.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <MotionStatusBadge status={motion.status} />
              <MotionKindBadge kind={motion.kind} />
            </div>
          </div>
          <MotionControls
            id={motion.id}
            title={motion.title}
            kind={motion.kind}
            status={motion.status}
            votesCast={t.voted}
            editable={{
              id: motion.id,
              kind: motion.kind,
              meetingId: motion.meeting?.id ?? null,
              title: motion.title,
              body: motion.body,
              threshold: motion.threshold,
              movedById: motion.movedBy?.id ?? null,
              secondedById: motion.secondedBy?.id ?? null,
            }}
            options={options}
            defaultClosesAt={defaultClosesAt}
            minClosesAt={minClosesAt}
            actions={actions}
          />
        </div>
      </div>

      {motion.result ? (
        <Card className={motion.result.passed ? "border-sage" : "border-coral"} data-testid="motion-result">
          <h2 className="text-lg font-bold text-charcoal">{motion.result.passed ? "Motion passed" : "Motion failed"}</h2>
          <p className="mt-1 text-sm text-stone-600">{motion.result.reason}</p>
          {motion.closedAt ? <p className="mt-1 text-xs text-stone-400">Closed {formatDateTime(motion.closedAt)}</p> : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Motion text" />
          <p className="whitespace-pre-wrap break-words text-sm text-charcoal">{motion.body}</p>
        </Card>
        <Card>
          <CardHeader title="How it is decided" />
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold text-stone-400">Kind</dt>
              <dd className="text-charcoal">{KIND_LABELS[motion.kind]}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-stone-400">Threshold</dt>
              <dd className="text-charcoal">{THRESHOLD_LABELS[motion.threshold]}</dd>
              <dd className="mt-0.5 text-xs text-stone-500">{THRESHOLD_EXPLAINERS[motion.threshold]}</dd>
            </div>
            {motion.meeting ? (
              <div>
                <dt className="text-xs font-semibold text-stone-400">Meeting</dt>
                <dd className="text-charcoal">
                  <Link href={`/admin/board/meetings/${motion.meeting.id}`} className="underline underline-offset-2">
                    {motion.meeting.title}
                  </Link>{" "}
                  <span className="text-xs text-stone-500">{formatDateTime(motion.meeting.startsAt)}</span>
                </dd>
              </div>
            ) : null}
            {motion.quorumRequired !== null ? (
              <div>
                <dt className="text-xs font-semibold text-stone-400">Quorum</dt>
                <dd className="text-charcoal">
                  {motion.quorumRequired} directors required{t.present !== null ? `, ${t.present} present or remote` : ""}
                </dd>
              </div>
            ) : null}
            {motion.closesAt ? (
              <div>
                <dt className="text-xs font-semibold text-stone-400">Voting closes</dt>
                <dd className="text-charcoal">{formatDateTime(motion.closesAt)}</dd>
              </div>
            ) : null}
            {motion.movedBy || motion.secondedBy ? (
              <div>
                <dt className="text-xs font-semibold text-stone-400">Moved / seconded</dt>
                <dd className="text-charcoal">
                  {motion.movedBy?.name ?? "—"} / {motion.secondedBy?.name ?? "—"}
                </dd>
              </div>
            ) : null}
            {motion.openedAt ? (
              <div>
                <dt className="text-xs font-semibold text-stone-400">Opened</dt>
                <dd className="text-charcoal">{formatDateTime(motion.openedAt)}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
      </div>

      {showVotes ? (
        <Card data-testid="tally">
          <CardHeader title="Live tally" description="Abstentions are not counted as votes cast." />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Yes", t.yes],
              ["No", t.no],
              ["Abstain", t.abstain],
              ["Not voted", notVoted],
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-2xl bg-alabaster px-4 py-3">
                <div className="text-2xl font-bold text-charcoal">{n}</div>
                <div className="text-xs font-semibold text-stone-500">{label}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={motion.seatsArePreview ? "Directors who would be eligible now" : "Eligible directors"}
          description={
            motion.seatsArePreview
              ? "The eligible directors are fixed when you open voting."
              : "Fixed when voting opened. Directors added or removed since then are not counted."
          }
        />
        {motion.seats.length === 0 ? (
          <p className="text-sm text-stone-500">There are no seated voting directors.</p>
        ) : (
          <Table className="min-w-[680px]">
            <THead>
              <tr>
                <TH className="pl-2">Director</TH>
                {motion.kind === "in_meeting" ? <TH>Attendance</TH> : <TH>Account</TH>}
                <TH>Vote</TH>
                <TH className="pr-2">Recorded</TH>
              </tr>
            </THead>
            <TBody>
              {motion.seats.map((s) => (
                <TR key={s.boardMemberId} data-testid="seat-row">
                  <TD className="pl-2">
                    <div className="font-semibold text-charcoal">{s.displayName}</div>
                    <div className="text-xs text-stone-500">{s.position}</div>
                  </TD>
                  <TD className="text-xs text-stone-600">
                    {motion.kind === "in_meeting" ? (s.attendance ? ATTENDANCE_LABELS[s.attendance] : "Not recorded") : s.hasAccount ? "Linked" : <Badge tone="warning">No account</Badge>}
                  </TD>
                  <TD>
                    {s.vote ? (
                      <Badge tone={s.vote.choice === "yes" ? "success" : s.vote.choice === "no" ? "danger" : "neutral"}>{CHOICE_LABELS[s.vote.choice]}</Badge>
                    ) : (
                      <span className="text-xs text-stone-400">{showVotes ? "Not voted" : "—"}</span>
                    )}
                  </TD>
                  <TD className="pr-2 text-xs text-stone-600">
                    {s.vote ? (
                      <>
                        {formatDateTime(s.vote.castAt)}
                        <div className="text-stone-400">{s.vote.recordedBySelf ? "By the director" : `Recorded by ${s.vote.recordedByName ?? "the board"}`}</div>
                      </>
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

      {motion.kind === "in_meeting" && motion.status === "open" ? (
        <Card>
          <CardHeader title="Roll-call recorder" description="Record voice votes for directors marked present or remote. Each recorded vote is final." />
          <RollCallRecorder motionId={motion.id} seats={motion.seats} rollCall={actions.rollCall} />
        </Card>
      ) : null}
    </div>
  );
}
