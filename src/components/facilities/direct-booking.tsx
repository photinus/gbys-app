"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { ActionResult } from "@/lib/dal/context";
import { utcToLaDateTimeInput } from "@/lib/format";
import type { FacilityNode } from "@/lib/validation/facilities";
import { FacilitySelect } from "./facility-select";

export type DirectBookingAction = (prev: ActionResult<{ id: string }> | null, fd: FormData) => Promise<ActionResult<{ id: string }>>;

export function DirectBookingButton({
  flat,
  programs,
  fixedProgramId,
  action,
  label = "Book a facility",
}: {
  flat: FacilityNode[];
  programs: { id: string; name: string }[];
  /** Program pages pin the booking to their program. */
  fixedProgramId?: string;
  action: DirectBookingAction;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="direct-booking-open">
        <CalendarPlus className="h-4 w-4" /> {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Book a facility" description="Approved immediately. Double-booking is blocked, including across a facility and its parent or children.">
        {open ? <BookingForm flat={flat} programs={programs} fixedProgramId={fixedProgramId} action={action} onDone={() => setOpen(false)} /> : null}
      </Modal>
    </>
  );
}

function BookingForm({ flat, programs, fixedProgramId, action, onDone }: { flat: FacilityNode[]; programs: { id: string; name: string }[]; fixedProgramId?: string; action: DirectBookingAction; onDone: () => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(action);
  const [start, end] = useMemo(() => {
    const next = Math.ceil((Date.now() + 60_000) / 3_600_000) * 3_600_000;
    return [utcToLaDateTimeInput(new Date(next)), utcToLaDateTimeInput(new Date(next + 3_600_000))];
  }, []);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Booked");
    onDone();
  }, [state, toast, onDone]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <Field label="Facility">
        <FacilitySelect name="resourceId" flat={flat} placeholder="Choose a facility" required defaultValue="" />
      </Field>
      {fixedProgramId ? (
        <input type="hidden" name="programId" value={fixedProgramId} />
      ) : (
        <Field label="Program" hint="Leave empty for a maintenance or organization-wide block.">
          <Select name="programId" defaultValue="">
            <option value="">No program</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Title">
        <Input name="title" required maxLength={120} placeholder="Pirates practice" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" hint="Pacific time">
          <Input name="startsAt" type="datetime-local" required defaultValue={start} />
        </Field>
        <Field label="Ends" hint="Pacific time">
          <Input name="endsAt" type="datetime-local" required defaultValue={end} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea name="notes" rows={2} maxLength={500} />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Booking..." : "Book"}
        </Button>
      </div>
    </form>
  );
}
