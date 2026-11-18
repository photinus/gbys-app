"use client";

import { Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { createShiftAction, updateShiftAction } from "@/app/(portal)/volunteer/shifts/manage/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { ManageShiftItem } from "@/lib/dal/shifts";
import { utcToLaDateTimeInput } from "@/lib/format";
import { CATEGORY_LABELS, VOLUNTEER_CATEGORIES } from "@/lib/volunteer-categories";

export interface ProgramChoice {
  id: string;
  name: string;
}

export function NewShiftButton({
  programs,
  canOrgWide,
}: {
  programs: ProgramChoice[];
  canOrgWide: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New shift
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a shift"
        description="Times are Pacific time (Gold Beach)."
      >
        <ShiftForm programs={programs} canOrgWide={canOrgWide} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function EditShiftButton({
  shift,
  programs,
  canOrgWide,
}: {
  shift: ManageShiftItem;
  programs: ProgramChoice[];
  canOrgWide: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Edit ${shift.title}`}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit shift" description="Times are Pacific time.">
        <ShiftForm shift={shift} programs={programs} canOrgWide={canOrgWide} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function ShiftForm({
  shift,
  programs,
  canOrgWide,
  onDone,
}: {
  shift?: ManageShiftItem;
  programs: ProgramChoice[];
  canOrgWide: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(shift ? updateShiftAction : createShiftAction);

  useEffect(() => {
    if (!state?.ok) return;
    toast.success(shift ? "Shift updated" : "Shift created");
    onDone();
  }, [state, toast, onDone, shift]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      {shift ? <input type="hidden" name="shiftId" value={shift.id} /> : null}
      <Field label="Program">
        <Select name="programId" defaultValue={shift?.programId ?? (canOrgWide ? "" : (programs[0]?.id ?? ""))} required={!canOrgWide}>
          {canOrgWide ? <option value="">Org-wide (all programs)</option> : null}
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title">
        <Input name="title" required maxLength={120} defaultValue={shift?.title} placeholder="Concession stand, Saturday" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <Input
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={shift ? utcToLaDateTimeInput(shift.startsAt) : ""}
          />
        </Field>
        <Field label="Ends">
          <Input
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={shift ? utcToLaDateTimeInput(shift.endsAt) : ""}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          <Select name="category" defaultValue={shift?.category ?? "event_ops"}>
            {VOLUNTEER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Volunteer spots">
          <Input name="spotsTotal" type="number" min={1} max={500} required defaultValue={shift?.spotsTotal ?? 2} />
        </Field>
      </div>
      <Field label="Location" hint="Optional">
        <Input name="location" maxLength={160} defaultValue={shift?.location ?? ""} />
      </Field>
      <Field label="Description" hint="Optional">
        <Textarea name="description" rows={3} maxLength={1000} defaultValue={shift?.description ?? ""} />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : shift ? "Save changes" : "Create shift"}
        </Button>
      </div>
    </form>
  );
}
