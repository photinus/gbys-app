"use client";

import { useEffect } from "react";
import { Button, EmptyState, Select, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { recordAttendanceAction } from "@/app/(admin)/admin/board/meetings/actions";
import type { MeetingSeatRow } from "@/lib/dal/board-meetings";
import { ATTENDANCE_LABELS, ATTENDANCE_STATUSES } from "@/lib/validation/board";

export function AttendanceForm({ meetingId, seats, disabled }: { meetingId: string; seats: MeetingSeatRow[]; disabled?: boolean }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(recordAttendanceAction);
  useEffect(() => {
    if (state?.ok) toast.success("Attendance saved");
  }, [state, toast]);

  if (seats.length === 0) {
    return (
      <EmptyState
        title="No voting directors were seated at the start time"
        description="Attendance covers the voting seats whose term includes the meeting's start. Add seats on the Members page."
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="attendance-form">
      <input type="hidden" name="meetingId" value={meetingId} />
      <ul className="divide-y divide-line-soft">
        {seats.map((s) => (
          <li key={s.boardMemberId} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-charcoal">{s.displayName}</p>
              <p className="text-xs text-stone-500">{s.position}</p>
            </div>
            <div className="sm:w-44">
              <Select name={`status_${s.boardMemberId}`} defaultValue={s.status ?? ""} aria-label={`Attendance for ${s.displayName}`} disabled={disabled}>
                <option value="">Not recorded</option>
                {ATTENDANCE_STATUSES.map((a) => (
                  <option key={a} value={a}>
                    {ATTENDANCE_LABELS[a]}
                  </option>
                ))}
              </Select>
            </div>
          </li>
        ))}
      </ul>
      <FormError state={state} />
      {!disabled ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save attendance"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
