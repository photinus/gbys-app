"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, Field, Input, Modal, Table, TBody, TD, TH, THead, TR, Textarea, useToast } from "@/components/ui";
import {
  createCredentialTypeAction,
  setCredentialTypeActiveAction,
  updateCredentialTypeAction,
} from "@/app/(admin)/admin/settings/credentials/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { CredentialTypeAdminRow } from "@/lib/dal/credential-types";

type Row = CredentialTypeAdminRow;

export function CredentialTypesPanel({ rows }: { rows: Row[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [toggling, setToggling] = useState<Row | null>(null);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New credential type
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No credential types" description="Create the first type volunteers can submit." />
      ) : (
        <>
          <div className="hidden md:block">
            <Table className="min-w-[760px]">
              <THead>
                <tr>
                  <TH className="pl-2">Type</TH>
                  <TH>Validity</TH>
                  <TH>Credentials</TH>
                  <TH>Required by</TH>
                  <TH className="pr-2 text-right">Actions</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id} data-testid="credential-type-row">
                    <TD className="pl-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-charcoal">{r.name}</span>
                        {!r.isActive ? <Badge>Archived</Badge> : null}
                      </div>
                      <div className="font-mono text-xs text-stone-500">{r.code}</div>
                    </TD>
                    <TD className="text-stone-600">{r.defaultValidityMonths} mo</TD>
                    <TD className="text-stone-600">
                      {r.totalCredentials} total / {r.verifiedCredentials} verified
                    </TD>
                    <TD className="max-w-[16rem] text-stone-600">
                      {r.requiredByPrograms.length ? r.requiredByPrograms.map((p) => p.name).join(", ") : "None"}
                    </TD>
                    <TD className="pr-2 text-right">
                      <RowActions r={r} onEdit={setEditing} onToggle={setToggling} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="rounded-2xl border border-line p-4" data-testid="credential-type-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-charcoal">{r.name}</span>
                  {!r.isActive ? <Badge>Archived</Badge> : null}
                </div>
                <div className="break-all font-mono text-xs text-stone-500">{r.code}</div>
                <p className="mt-2 text-xs text-stone-600">
                  {r.defaultValidityMonths} months, {r.totalCredentials} credentials ({r.verifiedCredentials} verified)
                </p>
                <p className="text-xs text-stone-600">
                  Required by: {r.requiredByPrograms.length ? r.requiredByPrograms.map((p) => p.name).join(", ") : "None"}
                </p>
                <div className="mt-3 flex gap-2">
                  <RowActions r={r} onEdit={setEditing} onToggle={setToggling} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New credential type"
        description="The code can't be changed after creation."
      >
        <CreateForm onDone={() => setCreating(false)} />
      </Modal>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit credential type"
        description="A validity change applies to new submissions only."
      >
        {editing ? <EditForm row={editing} onDone={() => setEditing(null)} /> : null}
      </Modal>
      <Modal
        open={toggling !== null}
        onClose={() => setToggling(null)}
        title={toggling?.isActive ? "Archive credential type?" : "Restore credential type?"}
      >
        {toggling ? <ToggleForm row={toggling} onDone={() => setToggling(null)} /> : null}
      </Modal>
    </>
  );
}

function RowActions({ r, onEdit, onToggle }: { r: Row; onEdit: (r: Row) => void; onToggle: (r: Row) => void }) {
  return (
    <div className="inline-flex gap-2">
      <Button variant="secondary" size="sm" onClick={() => onEdit(r)}>
        Edit
      </Button>
      <Button variant={r.isActive ? "danger" : "secondary"} size="sm" onClick={() => onToggle(r)}>
        {r.isActive ? "Archive" : "Restore"}
      </Button>
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(createCredentialTypeAction);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Credential type created");
    onDone();
    router.refresh();
  }, [state, toast, onDone, router]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <Field label="Name">
        <Input name="name" required minLength={2} maxLength={120} placeholder="Youth First Aid" />
      </Field>
      <Field label="Code" hint="Lowercase snake_case, unique, permanent (e.g. youth_first_aid).">
        <Input name="code" required maxLength={50} placeholder="youth_first_aid" autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="Description (optional)">
        <Textarea name="description" rows={3} maxLength={1000} />
      </Field>
      <Field label="Default validity (months)" hint="1 to 120. Used to compute expiry when none is entered.">
        <Input name="defaultValidityMonths" type="number" inputMode="numeric" min={1} max={120} step={1} defaultValue={24} required />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating..." : "Create type"}
        </Button>
      </div>
    </form>
  );
}

function EditForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(updateCredentialTypeAction);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success(state.data.changed.length ? "Credential type saved" : "No changes to save");
    onDone();
    router.refresh();
  }, [state, toast, onDone, router]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="id" value={row.id} />
      <Field label="Code" hint="Permanent.">
        <Input value={row.code} readOnly disabled className="font-mono" />
      </Field>
      <Field label="Name">
        <Input name="name" required minLength={2} maxLength={120} defaultValue={row.name} />
      </Field>
      <Field label="Description (optional)">
        <Textarea name="description" rows={3} maxLength={1000} defaultValue={row.description ?? ""} />
      </Field>
      <Field label="Default validity (months)" hint="Applies to new submissions only.">
        <Input name="defaultValidityMonths" type="number" inputMode="numeric" min={1} max={120} step={1} defaultValue={row.defaultValidityMonths} required />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ToggleForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const { state, pending, onSubmit } = useActionForm(setCredentialTypeActiveAction);
  const archiving = row.isActive;
  useEffect(() => {
    if (!state?.ok) return;
    toast.success(archiving ? "Credential type archived" : "Credential type restored");
    onDone();
    router.refresh();
  }, [state, toast, onDone, router, archiving]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="intent" value={archiving ? "archive" : "restore"} />
      {archiving ? (
        <>
          <p className="text-stone-600">
            <span className="font-semibold text-charcoal">{row.name}</span> will no longer be offered for new submissions.
            Existing credentials keep this type and stay visible. Nothing is deleted, and you can restore it later.
          </p>
          {row.requiredByPrograms.length ? (
            <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950">
              Still required by: {row.requiredByPrograms.map((p) => p.name).join(", ")}. Those programs keep requiring it
              until you remove it in the program settings.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-stone-600">
          <span className="font-semibold text-charcoal">{row.name}</span> will be offered for new submissions again.
        </p>
      )}
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant={archiving ? "danger" : "primary"} disabled={pending}>
          {pending ? "Working..." : archiving ? "Archive" : "Restore"}
        </Button>
      </div>
    </form>
  );
}
