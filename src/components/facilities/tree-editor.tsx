"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, EmptyState, Modal, Switch, useToast } from "@/components/ui";
import type { ActionResult } from "@/lib/dal/context";
import { RESOURCE_KIND_LABELS, type FacilityNode } from "@/lib/validation/facilities";
import { FacilityFormModal, type SaveFacilityAction } from "./facility-form-modal";

export interface TreeActions {
  save: SaveFacilityAction;
  deactivate: (id: string) => Promise<ActionResult<{ deactivated: number }>>;
  reactivate: (id: string) => Promise<ActionResult>;
}

export function TreeEditor({ tree, actions, showInactive }: { tree: FacilityNode[]; actions: TreeActions; showInactive: boolean }) {
  const toast = useToast();
  const [form, setForm] = useState<{ facility: FacilityNode | null; parentId: string | null } | null>(null);
  const [confirm, setConfirm] = useState<FacilityNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rows: FacilityNode[] = [];
  const walk = (list: FacilityNode[]) =>
    list.forEach((n) => {
      if (showInactive || n.isActive) rows.push(n);
      walk(n.children);
    });
  walk(tree);

  const deactivate = () => {
    if (!confirm) return;
    setError(null);
    start(async () => {
      const res = await actions.deactivate(confirm.id);
      if (!res.ok) return setError(res.error);
      toast.success(`${confirm.name} deactivated`);
      setConfirm(null);
    });
  };
  const reactivate = (n: FacilityNode) =>
    start(async () => {
      const res = await actions.reactivate(n.id);
      if (res.ok) toast.success(`${n.name} reactivated`);
      else toast.error("Could not reactivate", res.error);
    });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="text-lg font-bold text-charcoal">Facility tree</h2>
          <p className="text-xs text-stone-500">Complexes contain fields, gyms contain mats. Booking a parent blocks all its children.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-stone-600">
            <ShowInactiveToggle on={showInactive} />
            Show inactive
          </label>
          <Button size="sm" onClick={() => setForm({ facility: null, parentId: null })}>
            <Plus className="h-4 w-4" /> Add facility
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No facilities yet" description="Add a complex or a gym, then add its fields or mats inside it." />
      ) : (
        <ul className="divide-y divide-line-soft" data-testid="facility-tree">
          {rows.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3" style={{ paddingLeft: `${Math.min(n.depth, 6) * 20}px` }} data-testid="facility-row">
              <div className="min-w-0">
                <p className={`truncate text-sm font-semibold ${n.isActive ? "text-charcoal" : "text-stone-400 line-through"}`}>{n.name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge tone="info">{RESOURCE_KIND_LABELS[n.kind]}</Badge>
                  {!n.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
                  {n.locationAddress ? <span className="max-w-[16rem] truncate text-xs text-stone-500">{n.locationAddress}</span> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {n.isActive ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setForm({ facility: null, parentId: n.id })} aria-label={`Add inside ${n.name}`}>
                      <Plus className="h-3.5 w-3.5" /> Add inside
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setForm({ facility: n, parentId: null })} aria-label={`Edit ${n.name}`}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => (setError(null), setConfirm(n))} aria-label={`Deactivate ${n.name}`}>
                      Deactivate
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" disabled={pending} onClick={() => reactivate(n)}>
                    Reactivate
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <FacilityFormModal open={!!form} onClose={() => setForm(null)} facility={form?.facility ?? null} presetParentId={form?.parentId ?? null} tree={tree} action={actions.save} />
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm ? `Deactivate ${confirm.name}?` : "Deactivate"} description="It and everything inside it disappear from pickers. History is kept.">
        {error ? (
          <p role="alert" className="mb-4 rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Keep
          </Button>
          <Button variant="danger" disabled={pending} onClick={deactivate}>
            {pending ? "Working..." : "Deactivate"}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function ShowInactiveToggle({ on }: { on: boolean }) {
  // Keeps the toggle in the URL (shareable) and the list server-rendered.
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Switch
      checked={on}
      onChange={(e) => router.replace(`${pathname}?tab=facilities${e.target.checked ? "&inactive=1" : ""}`)}
      aria-label="Show inactive facilities"
    />
  );
}
