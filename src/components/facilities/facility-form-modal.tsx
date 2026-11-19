"use client";

import { useEffect, useMemo } from "react";
import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { ActionResult } from "@/lib/dal/context";
import { RESOURCE_KINDS, RESOURCE_KIND_LABELS, flattenFacilityTree, subtreeIds, type FacilityNode } from "@/lib/validation/facilities";
import { FacilitySelect } from "./facility-select";

export type SaveFacilityAction = (prev: ActionResult<{ id: string }> | null, fd: FormData) => Promise<ActionResult<{ id: string }>>;

export function FacilityFormModal({
  open,
  onClose,
  facility,
  presetParentId,
  tree,
  action,
}: {
  open: boolean;
  onClose: () => void;
  /** Editing this facility; null = create. */
  facility: FacilityNode | null;
  presetParentId: string | null;
  tree: FacilityNode[];
  action: SaveFacilityAction;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={facility ? `Edit ${facility.name}` : presetParentId ? "Add sub-facility" : "Add facility"}
      description="A booked facility also blocks everything above and below it in the tree."
    >
      {open ? <Form key={facility?.id ?? `new-${presetParentId}`} facility={facility} presetParentId={presetParentId} tree={tree} action={action} onDone={onClose} /> : null}
    </Modal>
  );
}

function Form({ facility, presetParentId, tree, action, onDone }: { facility: FacilityNode | null; presetParentId: string | null; tree: FacilityNode[]; action: SaveFacilityAction; onDone: () => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(action);
  const flat = useMemo(() => flattenFacilityTree(tree).filter((f) => f.isActive), [tree]);
  const exclude = useMemo(() => (facility ? subtreeIds(tree, facility.id) : undefined), [tree, facility]);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success(facility ? "Facility updated" : "Facility added");
    onDone();
  }, [state, toast, onDone, facility]);

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      {facility ? <input type="hidden" name="id" value={facility.id} /> : null}
      <Field label="Name">
        <Input name="name" required maxLength={80} defaultValue={facility?.name ?? ""} placeholder="Field A" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind">
          <Select name="kind" defaultValue={facility?.kind ?? "field"}>
            {RESOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {RESOURCE_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Inside">
          <FacilitySelect name="parentId" flat={flat} excludeIds={exclude} placeholder="Top level" defaultValue={facility ? (facility.parentResourceId ?? "") : (presetParentId ?? "")} />
        </Field>
      </div>
      <Field label="Address" hint="Shown on team calendars.">
        <Input name="locationAddress" maxLength={200} defaultValue={facility?.locationAddress ?? ""} />
      </Field>
      <Field label="Notes">
        <Textarea name="notes" rows={2} maxLength={500} defaultValue={facility?.notes ?? ""} />
      </Field>
      {facility ? (
        <Field label="Sort order" hint="Lower numbers list first among siblings.">
          <Input name="sortOrder" type="number" min={0} max={9999} defaultValue={facility.sortOrder} />
        </Field>
      ) : null}
      <FormError state={state} />
      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : facility ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
