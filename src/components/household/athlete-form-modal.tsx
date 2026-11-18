"use client";

import { useEffect } from "react";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { createAthleteAction, updateAthleteAction } from "@/app/(portal)/household/actions";
import type { AthleteDetail } from "@/lib/dal/households";
import { utcToLaDateInput } from "@/lib/format";
import { EmergencyContactsFields } from "./emergency-contacts-fields";
import { FormError } from "./form-error";
import { useActionForm } from "./use-action-form";

/** Add (athlete undefined) or edit (athlete = audited detail) an athlete. */
export function AthleteFormModal({
  open,
  onClose,
  athlete,
}: {
  open: boolean;
  onClose: () => void;
  athlete?: AthleteDetail | null;
}) {
  const editing = !!athlete;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${athlete.firstName}` : "Add athlete"}
      description={
        editing
          ? "Changes to medical notes and emergency contacts are recorded in the audit log."
          : "Athletes do not have their own accounts; you manage them as their guardian."
      }
    >
      {/* Mounted only while open, so the form starts fresh every time. */}
      <AthleteForm athlete={athlete ?? null} onDone={onClose} />
    </Modal>
  );
}

function AthleteForm({ athlete, onDone }: { athlete: AthleteDetail | null; onDone: () => void }) {
  const toast = useToast();
  const editing = !!athlete;
  const { state, pending, onSubmit } = useActionForm<{ id: string }>(
    editing ? updateAthleteAction : createAthleteAction
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success(editing ? "Athlete updated" : "Athlete added");
      onDone();
    }
  }, [state, editing, toast, onDone]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      {athlete ? <input type="hidden" name="athleteId" value={athlete.id} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name">
          <Input name="firstName" defaultValue={athlete?.firstName} required maxLength={60} />
        </Field>
        <Field label="Last name">
          <Input name="lastName" defaultValue={athlete?.lastName} required maxLength={60} />
        </Field>
        <Field label="Date of birth">
          <Input
            name="dateOfBirth"
            type="date"
            defaultValue={athlete?.dateOfBirth}
            min="1900-01-01"
            max={utcToLaDateInput(new Date())}
            required
          />
        </Field>
        <Field label="Grade" hint="e.g. K, 3, 8">
          <Input name="gradeLevel" defaultValue={athlete?.gradeLevel ?? ""} maxLength={20} />
        </Field>
        <Field label="Gender (optional)">
          <Select name="gender" defaultValue={athlete?.gender ?? ""}>
            <option value="">Prefer not to say</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Non-binary">Non-binary</option>
          </Select>
        </Field>
        {!editing ? (
          <Field label="Your relationship">
            <Select name="relationship" defaultValue="Parent">
              <option>Parent</option>
              <option>Legal Guardian</option>
              <option>Grandparent</option>
              <option>Other</option>
            </Select>
          </Field>
        ) : null}
      </div>
      <Field label="Medical notes" hint="Allergies, asthma inhaler, EpiPen, etc. Max 2,000 characters.">
        <Textarea name="medicalNotes" defaultValue={athlete?.medicalNotes ?? ""} maxLength={2000} />
      </Field>
      <EmergencyContactsFields initial={athlete?.emergencyContacts} />
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : editing ? "Save changes" : "Add athlete"}
        </Button>
      </div>
    </form>
  );
}
