"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Modal, Textarea, useToast, type BadgeTone } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { ActionResult } from "@/lib/dal/context";
import type { BookingRequestRow } from "@/lib/dal/facilities";
import { formatDateTime, formatTimeRange } from "@/lib/format";
import type { BookingStatus } from "@/lib/validation/facilities";
import type { SeriesApprovalView } from "./action-impl";

export interface QueueActions {
  approve: (id: string) => Promise<ActionResult>;
  approveSeries: (seriesId: string) => Promise<ActionResult<SeriesApprovalView>>;
  decline: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  cancel: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
}

const STATUS_TONE: Record<BookingStatus, BadgeTone> = { requested: "warning", approved: "success", declined: "danger", cancelled: "neutral" };
const STATUS_LABEL: Record<BookingStatus, string> = { requested: "Requested", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };

type Reason = { kind: "decline" | "cancel"; row: BookingRequestRow };

export function RequestQueue({ rows, actions, showProgram }: { rows: BookingRequestRow[]; actions: QueueActions; showProgram: boolean }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState<Reason | null>(null);
  const [seriesResult, setSeriesResult] = useState<SeriesApprovalView | null>(null);

  const approve = (r: BookingRequestRow) => {
    setBusyId(r.id);
    start(async () => {
      const res = await actions.approve(r.id);
      setBusyId(null);
      if (res.ok) toast.success("Approved", r.title);
      else toast.error("Could not approve", res.error);
    });
  };
  const approveSeries = (r: BookingRequestRow) => {
    if (!r.seriesId) return;
    setBusyId(r.id);
    start(async () => {
      const res = await actions.approveSeries(r.seriesId!);
      setBusyId(null);
      if (!res.ok) return toast.error("Could not approve series", res.error);
      if (res.data.conflicted.length || res.data.skipped.length) setSeriesResult(res.data);
      else toast.success(`Approved ${res.data.approved} occurrence${res.data.approved === 1 ? "" : "s"}`, r.title);
    });
  };

  if (rows.length === 0) return <EmptyState title="Nothing here" description="No bookings match this view." />;

  return (
    <>
      <ul className="space-y-3" data-testid="request-list">
        {rows.map((r) => (
          <li key={r.id}>
            <Card className="!p-4 sm:!p-5" data-testid="request-card" data-status={r.status}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-sm font-bold text-charcoal">{r.title}</h3>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.seriesId && r.status === "requested" && r.seriesPending > 1 ? <Badge tone="info">Series of {r.seriesPending}</Badge> : null}
                    {r.isPast ? <Badge tone="neutral">Past</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-stone-700">
                    <span className="font-semibold">{r.resourceName}</span> · {formatTimeRange(r.startsAt, r.endsAt)}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {showProgram && r.programName ? <>{r.programName} · </> : null}
                    {r.teamName ? (
                      <>
                        <span className="inline-block h-2 w-2 rounded-full align-baseline" style={{ background: r.teamColor ?? "#a8a29e" }} /> {r.teamName} ·{" "}
                      </>
                    ) : null}
                    Requested by {r.requesterName} on {formatDateTime(r.createdAt)}
                  </p>
                  {r.notes ? <p className="mt-1 text-xs text-stone-600">{r.notes}</p> : null}
                  {r.decisionNote && (r.status === "declined" || r.status === "cancelled") ? <p className="mt-1 text-xs text-stone-600">Reason: {r.decisionNote}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.status === "requested" ? (
                    <>
                      <Button size="sm" disabled={pending || r.conflicts.length > 0 || r.isPast} onClick={() => approve(r)} data-testid="approve">
                        <Check className="h-3.5 w-3.5" /> {busyId === r.id ? "Working..." : "Approve"}
                      </Button>
                      {r.seriesId && r.seriesPending > 1 ? (
                        <Button size="sm" variant="secondary" disabled={pending} onClick={() => approveSeries(r)} data-testid="approve-series">
                          Approve series ({r.seriesPending})
                        </Button>
                      ) : null}
                      <Button size="sm" variant="danger" disabled={pending} onClick={() => setReason({ kind: "decline", row: r })} data-testid="decline">
                        Decline
                      </Button>
                    </>
                  ) : null}
                  {r.status === "approved" && !r.isPast ? (
                    <Button size="sm" variant="secondary" onClick={() => setReason({ kind: "cancel", row: r })} data-testid="cancel">
                      Cancel booking
                    </Button>
                  ) : null}
                </div>
              </div>
              {r.status === "requested" ? <ConflictPreview row={r} /> : null}
            </Card>
          </li>
        ))}
      </ul>
      <ReasonModal reason={reason} onClose={() => setReason(null)} actions={actions} />
      <Modal open={!!seriesResult} onClose={() => setSeriesResult(null)} title="Series approval" description={seriesResult ? `${seriesResult.approved} approved. The rest need attention.` : undefined}>
        {seriesResult ? (
          <div className="space-y-3 text-sm" data-testid="series-result">
            {seriesResult.conflicted.length ? (
              <div>
                <p className="font-semibold text-rose-900">Not approved, conflicts ({seriesResult.conflicted.length})</p>
                <ul className="mt-1 space-y-1 text-xs text-stone-700">
                  {seriesResult.conflicted.map((c) => (
                    <li key={c.id}>
                      {formatTimeRange(c.startsAt, c.endsAt)}: conflicts with {c.conflictsWith.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {seriesResult.skipped.length ? (
              <div>
                <p className="font-semibold text-amber-950">Skipped ({seriesResult.skipped.length})</p>
                <ul className="mt-1 space-y-1 text-xs text-stone-700">
                  {seriesResult.skipped.map((s) => (
                    <li key={s.id}>
                      {formatDateTime(s.startsAt)}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button onClick={() => setSeriesResult(null)}>Done</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function ConflictPreview({ row }: { row: BookingRequestRow }) {
  return (
    <div className="mt-3 space-y-2" data-testid="conflict-preview">
      {row.conflicts.length ? (
        <div className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs text-rose-950" data-testid="conflict-blocked">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> Cannot approve, it conflicts with {row.conflicts.length} approved booking{row.conflicts.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 space-y-0.5">
            {row.conflicts.map((c) => (
              <li key={c.id}>
                {c.title} · {c.resourceName} · {formatTimeRange(c.startsAt, c.endsAt)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-xl bg-sage/25 px-3.5 py-2 text-xs font-medium text-emerald-950" data-testid="conflict-clear">
          No conflicts right now.
        </p>
      )}
      {row.competing.length ? (
        <p className="rounded-xl bg-amber-soft/30 px-3.5 py-2 text-xs text-amber-950">
          Competing request{row.competing.length === 1 ? "" : "s"} for the same time: {row.competing.map((c) => `${c.title} (${c.resourceName})`).join(", ")}. Approving one will block the other.
        </p>
      ) : null}
    </div>
  );
}

function ReasonModal({ reason, onClose, actions }: { reason: Reason | null; onClose: () => void; actions: QueueActions }) {
  const isDecline = reason?.kind === "decline";
  return (
    <Modal
      open={!!reason}
      onClose={onClose}
      title={reason ? `${isDecline ? "Decline" : "Cancel"}: ${reason.row.title}` : ""}
      description={isDecline ? "The requester sees your reason." : "This frees the time for others."}
    >
      {reason ? <ReasonForm key={reason.row.id + reason.kind} reason={reason} onDone={onClose} action={isDecline ? actions.decline : actions.cancel} /> : null}
    </Modal>
  );
}

function ReasonForm({ reason, onDone, action }: { reason: Reason; onDone: () => void; action: QueueActions["decline"] }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(action);
  const decline = reason.kind === "decline";
  useEffect(() => {
    if (!state?.ok) return;
    toast.success(decline ? "Request declined" : "Booking cancelled");
    onDone();
  }, [state, toast, onDone, decline]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="id" value={reason.row.id} />
      <Field label="Reason">
        <Textarea name="reason" rows={3} required minLength={3} maxLength={500} placeholder={decline ? "Field is closed for reseeding that week..." : "Game rescheduled..."} />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Saving..." : decline ? "Decline request" : "Cancel booking"}
        </Button>
      </div>
    </form>
  );
}
