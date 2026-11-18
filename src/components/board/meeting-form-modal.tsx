"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Field, Input, Modal, Select, Switch, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { createMeetingAction, updateMeetingAction } from "@/app/(admin)/admin/board/meetings/actions";
import { utcToLaDateTimeInput } from "@/lib/format";
import { MEETING_KINDS, MEETING_KIND_LABELS } from "@/lib/validation/board";

export interface EditableMeeting {
  id: string;
  title: string;
  kind: (typeof MEETING_KINDS)[number];
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  virtualUrl: string | null;
  agenda: string | null;
  isPublic: boolean;
}

export function MeetingFormModal({ open, onClose, meeting }: { open: boolean; onClose: () => void; meeting?: EditableMeeting | null }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meeting ? "Edit meeting" : "Schedule a meeting"}
      description="Times are Pacific. Public meetings appear on every member's Board meetings page."
    >
      <MeetingForm key={meeting?.id ?? "new"} meeting={meeting ?? null} onDone={onClose} />
    </Modal>
  );
}

function MeetingForm({ meeting, onDone }: { meeting: EditableMeeting | null; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const editing = !!meeting;
  const create = useActionForm(createMeetingAction);
  const update = useActionForm(updateMeetingAction);
  const { state, pending, onSubmit } = (editing ? update : create) as ReturnType<typeof useActionForm<unknown>>;

  useEffect(() => {
    if (!state?.ok) return;
    toast.success(editing ? "Meeting saved" : "Meeting scheduled");
    onDone();
    if (!editing) router.push(`/admin/board/meetings/${(state.data as { id: string }).id}`);
  }, [state, toast, onDone, editing, router]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      {meeting ? <input type="hidden" name="id" value={meeting.id} /> : null}
      <Field label="Title">
        <Input name="title" required minLength={2} maxLength={120} defaultValue={meeting?.title} placeholder="Regular board meeting" />
      </Field>
      <Field label="Type">
        <Select name="kind" defaultValue={meeting?.kind ?? "regular"}>
          {MEETING_KINDS.map((k) => (
            <option key={k} value={k}>
              {MEETING_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <Input name="startsAt" type="datetime-local" required defaultValue={meeting ? utcToLaDateTimeInput(meeting.startsAt) : ""} />
        </Field>
        <Field label="Ends (optional)">
          <Input name="endsAt" type="datetime-local" defaultValue={meeting?.endsAt ? utcToLaDateTimeInput(meeting.endsAt) : ""} />
        </Field>
      </div>
      <Field label="Location (optional)">
        <Input name="location" maxLength={200} defaultValue={meeting?.location ?? ""} placeholder="Gold Beach Library, 29770 Colvin St" />
      </Field>
      <Field label="Video link (optional)" hint="A full https:// link for remote attendance.">
        <Input name="virtualUrl" type="url" maxLength={500} defaultValue={meeting?.virtualUrl ?? ""} placeholder="https://meet.example.com/gbys" />
      </Field>
      <Field label="Agenda (optional)" hint="Markdown is supported. Members see this on public meetings.">
        <Textarea name="agenda" rows={5} maxLength={20000} defaultValue={meeting?.agenda ?? ""} />
      </Field>
      <PublicSwitch defaultChecked={meeting?.isPublic ?? true} />
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : editing ? "Save meeting" : "Schedule meeting"}
        </Button>
      </div>
    </form>
  );
}

function PublicSwitch({ defaultChecked }: { defaultChecked: boolean }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-alabaster/60 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-charcoal">Show on the members&apos; schedule</p>
        <p className="text-xs text-stone-500">{on ? "Members can see the date, place, link and agenda." : "Board-only. Members won't see this meeting."}</p>
      </div>
      <Switch name="isPublic" checked={on} onChange={(e) => setOn(e.target.checked)} aria-label="Show on the members' schedule" />
    </div>
  );
}

export function NewMeetingButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> Schedule meeting
      </Button>
      <MeetingFormModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
