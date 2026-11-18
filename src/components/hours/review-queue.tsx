"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { PendingHoursRow } from "@/lib/dal/volunteer-hours";
import { formatDate, formatHours } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/volunteer-categories";
import { approveHoursAction, rejectHoursAction } from "@/app/(admin)/admin/hours/actions";

export function ReviewQueue({ rows }: { rows: PendingHoursRow[] }) {
  const toast = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingHoursRow | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) {
    return <EmptyState title="Queue is clear" description="No self-reported hours are waiting for review." />;
  }

  async function approve(r: PendingHoursRow) {
    if (busyId) return;
    setBusyId(r.id);
    const res = await approveHoursAction(r.id);
    setBusyId(null);
    if (res.ok) {
      toast.success("Hours approved", `${r.volunteerName || r.volunteerEmail}: ${formatHours(r.durationMinutes)}`);
    } else {
      toast.error("Could not approve", res.error);
    }
    router.refresh();
  }

  function openReject(r: PendingHoursRow) {
    setReason("");
    setError(null);
    setRejecting(r);
  }

  async function submitReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejecting || busyId) return;
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusyId(rejecting.id);
    const res = await rejectHoursAction(rejecting.id, reason);
    setBusyId(null);
    if (res.ok) {
      toast.success("Hours rejected");
      setRejecting(null);
      router.refresh();
    } else {
      setError(res.error);
      // The entry may already have been decided by someone else; refresh the queue.
      router.refresh();
    }
  }

  return (
    <>
      <Table className="min-w-[860px]">
        <THead>
          <tr>
            <TH className="pl-2">Volunteer</TH>
            <TH>Date</TH>
            <TH>Hours</TH>
            <TH>Program / category</TH>
            <TH>Description</TH>
            <TH className="pr-2 text-right">Decision</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id} data-testid="pending-row">
              <TD className="pl-2">
                <div className="font-semibold text-charcoal">{r.volunteerName || r.volunteerEmail}</div>
                <div className="text-xs text-stone-500">{r.volunteerEmail}</div>
              </TD>
              <TD className="whitespace-nowrap text-stone-600">{formatDate(r.activityDate)}</TD>
              <TD className="whitespace-nowrap font-semibold text-charcoal">{formatHours(r.durationMinutes)}</TD>
              <TD>
                <div className="text-charcoal">{r.programName ?? "Organization"}</div>
                <div className="text-xs text-stone-500">{CATEGORY_LABELS[r.category]}</div>
              </TD>
              <TD className="max-w-xs text-charcoal">{r.description || "-"}</TD>
              <TD className="pr-2">
                <div className="flex items-center justify-end gap-2">
                  {r.isOwn ? (
                    <span className="text-xs text-stone-500">Your entry: another board member must review it</span>
                  ) : (
                    <Button size="sm" onClick={() => approve(r)} disabled={busyId !== null}>
                      <Check className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                  )}
                  <Button variant="danger" size="sm" onClick={() => openReject(r)} disabled={busyId !== null}>
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </Button>
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject hours"
        description={
          rejecting
            ? `${rejecting.volunteerName || rejecting.volunteerEmail} · ${formatHours(rejecting.durationMinutes)} on ${formatDate(rejecting.activityDate)}`
            : undefined
        }
        footer={null}
      >
        <form onSubmit={submitReject} className="space-y-4" noValidate>
          <Field label="Reason" hint="The volunteer will see this." error={error}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={3}
              autoFocus
              name="reason"
            />
          </Field>
          <div className="flex items-center justify-end gap-2.5">
            <Button variant="ghost" onClick={() => setRejecting(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={busyId !== null}>
              {busyId ? "Rejecting..." : "Reject entry"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
