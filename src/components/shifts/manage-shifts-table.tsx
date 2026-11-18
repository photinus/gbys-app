"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, buttonStyles, EmptyState, Modal, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ui";
import { cancelShiftAction } from "@/app/(portal)/volunteer/shifts/manage/actions";
import type { ManageShiftItem } from "@/lib/dal/shifts";
import { formatTimeRange } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/volunteer-categories";
import { EditShiftButton, type ProgramChoice } from "./shift-form-modal";

export function ManageShiftsTable({
  shifts,
  programs,
  canOrgWide,
  past = false,
}: {
  shifts: ManageShiftItem[];
  programs: ProgramChoice[];
  canOrgWide: boolean;
  past?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [target, setTarget] = useState<ManageShiftItem | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmCancel = async () => {
    if (!target) return;
    setBusy(true);
    const res = await cancelShiftAction(target.id);
    setBusy(false);
    if (res.ok) {
      toast.success("Shift cancelled");
      setTarget(null);
      startTransition(() => router.refresh());
    } else toast.error(res.error);
  };

  if (shifts.length === 0) {
    return (
      <EmptyState
        title={past ? "No past shifts" : "No upcoming shifts"}
        description={past ? undefined : "Create a shift so volunteers can sign up."}
      />
    );
  }

  return (
    <>
      <Table>
        <THead>
          <tr>
            <TH>Shift</TH>
            <TH>When</TH>
            <TH>Filled</TH>
            <TH>Status</TH>
            <TH className="text-right">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {shifts.map((s) => (
            <TR key={s.id}>
              <TD>
                <p className="font-semibold text-charcoal">{s.title}</p>
                <p className="text-xs text-stone-500">
                  {s.programName ?? "Organization-wide"} · {CATEGORY_LABELS[s.category]}
                </p>
              </TD>
              <TD className="text-stone-600">{formatTimeRange(s.startsAt, s.endsAt)}</TD>
              <TD className="text-stone-600">
                {s.spotsFilled}/{s.spotsTotal}
                {s.checkedInCount > 0 ? (
                  <span className="block text-xs text-stone-400">{s.checkedInCount} checked in</span>
                ) : null}
              </TD>
              <TD>
                {s.cancelledAt ? <Badge tone="danger">Cancelled</Badge> : <Badge tone="success">Open</Badge>}
              </TD>
              <TD>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Link href={`/volunteer/shifts/${s.id}`} className={buttonStyles({ variant: "secondary", size: "sm" })}>
                    Roster
                  </Link>
                  {s.canManage && !s.cancelledAt ? (
                    <>
                      <EditShiftButton shift={s} programs={programs} canOrgWide={canOrgWide} />
                      <Button variant="danger" size="sm" onClick={() => setTarget(s)}>
                        Cancel
                      </Button>
                    </>
                  ) : null}
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title="Cancel this shift?"
        description={target?.title}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Keep shift
            </Button>
            <Button variant="danger" disabled={busy} onClick={confirmCancel}>
              {busy ? "Cancelling..." : "Cancel shift"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-stone-600">
          Volunteers will no longer see it. Hours already logged from check-ins stay in the ledger.
        </p>
      </Modal>
    </>
  );
}
