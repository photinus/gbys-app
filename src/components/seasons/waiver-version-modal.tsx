"use client";

import { useEffect } from "react";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { createWaiverVersionAction, type CreatedWaiver } from "@/app/(portal)/programs/[slug]/actions";
import { WAIVER_TEMPLATE_BODY, WAIVER_TEMPLATE_TITLE } from "@/lib/waiver-template";

export function WaiverVersionModal({
  open,
  onClose,
  onCreated,
  programId,
  programName,
  canOrgWide,
  suggestedVersion,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (w: CreatedWaiver) => void;
  programId: string;
  programName: string;
  canOrgWide: boolean;
  suggestedVersion: string;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New waiver version"
      description="Waivers are never edited: saving creates a new version that families sign from then on."
    >
      <WaiverForm
        onClose={onClose}
        onCreated={onCreated}
        programId={programId}
        programName={programName}
        canOrgWide={canOrgWide}
        suggestedVersion={suggestedVersion}
      />
    </Modal>
  );
}

function WaiverForm({
  onClose,
  onCreated,
  programId,
  programName,
  canOrgWide,
  suggestedVersion,
}: {
  onClose: () => void;
  onCreated: (w: CreatedWaiver) => void;
  programId: string;
  programName: string;
  canOrgWide: boolean;
  suggestedVersion: string;
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(createWaiverVersionAction);

  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Waiver version saved");
    onCreated(state.data);
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <div className="rounded-xl bg-amber-soft/30 px-3.5 py-2.5 text-xs text-amber-950">
        The pre-filled text is a draft template, not legal advice. Review it with counsel and edit it before saving.
      </div>
      {canOrgWide ? (
        <Field label="Applies to">
          <Select name="programId" defaultValue={programId}>
            <option value={programId}>{programName} only</option>
            <option value="">All GBYS programs (org-wide)</option>
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="programId" value={programId} />
      )}
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Title">
          <Input name="title" required maxLength={160} defaultValue={WAIVER_TEMPLATE_TITLE} />
        </Field>
        <Field label="Version">
          <Input name="version" required maxLength={40} defaultValue={suggestedVersion} />
        </Field>
      </div>
      <Field label="Waiver text" hint="Families read and sign exactly this text.">
        <Textarea name="body" required rows={12} defaultValue={WAIVER_TEMPLATE_BODY} className="font-mono text-xs" />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save waiver version"}
        </Button>
      </div>
    </form>
  );
}
