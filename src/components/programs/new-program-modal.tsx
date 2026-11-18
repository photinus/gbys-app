"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Field, Input, Label, Modal, Switch, Textarea, useToast } from "@/components/ui";
import { createProgramAction } from "@/app/(admin)/admin/programs/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { CredentialOption } from "@/lib/dal/programs";
import { CredentialPicker } from "./credential-picker";
import { slugify } from "./slugify";

export function NewProgramButton({ credentials }: { credentials: CredentialOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New program
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New program"
        description="Programs scope rosters, shifts and coach roles. You can edit everything later."
      >
        <NewProgramForm credentials={credentials} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function NewProgramForm({ credentials, onDone }: { credentials: CredentialOption[]; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(createProgramAction);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Program created");
    onDone();
    router.push(`/admin/programs/${state.data.id}`);
  }, [state, toast, onDone, router]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <Field label="Name">
        <Input
          name="name"
          required
          maxLength={120}
          placeholder="Youth Wrestling"
          onChange={(e) => {
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field label="Slug" hint="Lowercase letters, numbers and hyphens. Must be unique.">
        <Input
          name="slug"
          required
          maxLength={60}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          placeholder="youth-wrestling"
        />
      </Field>
      <Field label="Sport">
        <Input name="sport" required maxLength={60} placeholder="Wrestling" />
      </Field>
      <Field label="Description (optional)">
        <Textarea name="description" rows={3} maxLength={2000} />
      </Field>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="new-partner" className="mb-0 text-sm font-medium text-charcoal">
          Independent partner league
        </Label>
        <Switch id="new-partner" name="isIndependentPartner" />
      </div>
      <CredentialPicker options={credentials} />
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create program"}
        </Button>
      </div>
    </form>
  );
}
