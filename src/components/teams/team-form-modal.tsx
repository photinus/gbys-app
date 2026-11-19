"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { TEAM_COLOR_PRESETS } from "@/lib/validation/teams";
import {
  createTeamAction,
  updateTeamAction,
} from "@/app/(portal)/programs/[slug]/seasons/[seasonId]/teams/actions";
import { DEFAULT_TEAM_COLOR } from "./team-color";

export interface TeamFormValue {
  id: string;
  name: string;
  division: string | null;
  color: string | null;
  isActive: boolean;
}

/** Create (team === null) or edit a team. */
export function TeamFormModal({
  open,
  onClose,
  team,
  seasonId,
  slug,
  path,
  divisionHints,
}: {
  open: boolean;
  onClose: () => void;
  team: TeamFormValue | null;
  seasonId: string;
  slug: string;
  path: string;
  divisionHints: string[];
}) {
  const editing = team !== null;
  const action = editing ? updateTeamAction : createTeamAction;
  const { state, pending, onSubmit } = useActionForm(action);
  const toast = useToast();
  const [color, setColor] = useState(team?.color ?? "");

  useEffect(() => {
    if (state?.ok) {
      toast.success(editing ? "Team updated" : "Team created");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const formId = "team-form";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit team" : "New team"}
      description={editing ? undefined : "Teams belong to this season. Add players and coaches afterwards."}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save team" : "Create team"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-4">
        <input type="hidden" name="path" value={path} />
        <input type="hidden" name="slug" value={slug} />
        {editing ? <input type="hidden" name="teamId" value={team.id} /> : <input type="hidden" name="seasonId" value={seasonId} />}
        <FormError state={state} />
        <Field label="Team name">
          <Input name="name" defaultValue={team?.name ?? ""} maxLength={80} required autoFocus />
        </Field>
        <Field label="Division" hint="Optional, e.g. Minors (9-10U).">
          <Input name="division" defaultValue={team?.division ?? ""} maxLength={80} list="team-division-hints" />
        </Field>
        <datalist id="team-division-hints">
          {divisionHints.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <Field label="Calendar color">
          <div className="space-y-2">
            <input type="hidden" name="color" value={color} />
            <div className="flex flex-wrap items-center gap-2">
              {TEAM_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={color.toLowerCase() === c.toLowerCase()}
                  onClick={() => setColor(c)}
                  className="h-8 w-8 rounded-full ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-charcoal"
                  style={{ backgroundColor: c }}
                />
              ))}
              <button
                type="button"
                onClick={() => setColor("")}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal"
              >
                None
              </button>
            </div>
            <p className="text-xs text-stone-400">{color ? `Selected ${color}` : `No color (calendars use ${DEFAULT_TEAM_COLOR}).`}</p>
          </div>
        </Field>
        {editing ? (
          <label className="flex items-center justify-between gap-3 rounded-xl bg-alabaster px-3.5 py-3 text-sm">
            <span>
              <span className="block font-semibold text-charcoal">Active</span>
              <span className="block text-xs text-stone-500">Inactive teams are hidden from coaches and “My teams”.</span>
            </span>
            <Switch name="isActive" defaultChecked={team.isActive} />
          </label>
        ) : null}
      </form>
    </Modal>
  );
}
