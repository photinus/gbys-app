"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { createSeasonAction, type CreatedWaiver } from "@/app/(portal)/programs/[slug]/actions";
import { updateSeasonAction } from "@/app/(portal)/programs/[slug]/seasons/[seasonId]/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Card, CardHeader, Field, Input, Select, Switch, Textarea, buttonStyles, useToast } from "@/components/ui";
import type { SeasonEditorData, WaiverVersionRow } from "@/lib/dal/seasons";
import { formatDateTime, utcToLaDateTimeInput } from "@/lib/format";
import { FormBuilder, toBuilderFields, toDefinition, type BuilderField } from "./form-builder";
import { FormPreview } from "./form-preview";
import { WaiverVersionModal } from "./waiver-version-modal";

type SeasonLike = SeasonEditorData["season"];

export interface SeasonEditorProps {
  program: { id: string; slug: string; name: string };
  season?: SeasonLike;
  waiverVersions: WaiverVersionRow[];
  canOrgWideWaiver: boolean;
  liveRegistrations?: number;
}

export function SeasonEditor({ program, season, waiverVersions, canOrgWideWaiver, liveRegistrations = 0 }: SeasonEditorProps) {
  const toast = useToast();
  const router = useRouter();
  const isEdit = !!season;
  const { state: createState, pending: createPending, onSubmit: createSubmit } = useActionForm(createSeasonAction);
  const { state: updState, pending: updPending, onSubmit: updSubmit } = useActionForm(updateSeasonAction);
  const state = isEdit ? updState : createState;
  const pending = isEdit ? updPending : createPending;
  const onSubmit = isEdit ? updSubmit : createSubmit;

  const [fields, setFields] = useState<BuilderField[]>(() => toBuilderFields(season?.customFormSchema ?? []));
  const [waivers, setWaivers] = useState<WaiverVersionRow[]>(waiverVersions);
  const [waiverId, setWaiverId] = useState(season?.waiverVersionId ?? "");
  const [opens, setOpens] = useState(season?.registrationOpensAt ? utcToLaDateTimeInput(season.registrationOpensAt) : "");
  const [modalOpen, setModalOpen] = useState(false);

  const lockedKeys = useMemo(
    () => new Set(liveRegistrations > 0 ? (season?.customFormSchema ?? []).map((f) => f.key) : []),
    [liveRegistrations, season]
  );
  const feeLocked = liveRegistrations > 0;
  const selectedWaiver = waivers.find((w) => w.id === waiverId) ?? null;
  const definition = useMemo(() => toDefinition(fields), [fields]);

  useEffect(() => {
    if (!state?.ok) return;
    if (isEdit) {
      toast.success("Season saved");
      router.refresh();
    } else {
      toast.success("Season created");
      router.push(`/programs/${program.slug}/seasons/${(state.data as { id: string }).id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const onWaiverCreated = (w: CreatedWaiver) => {
    const row: WaiverVersionRow = { ...w, createdAt: new Date(w.createdAt) };
    setWaivers((prev) => [row, ...prev]);
    setWaiverId(row.id);
  };

  const noEnter = (e: KeyboardEvent<HTMLFormElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "submit") e.preventDefault();
  };

  const suggestedVersion = `v${waivers.filter((w) => w.programId === program.id).length + 1}`;

  return (
    <>
      <form onSubmit={onSubmit} onKeyDown={noEnter} className="space-y-6">
        <input type="hidden" name="programId" value={program.id} />
        <input type="hidden" name="slug" value={program.slug} />
        {season ? <input type="hidden" name="seasonId" value={season.id} /> : null}
        <input type="hidden" name="customFormSchema" value={JSON.stringify(definition)} />

        {liveRegistrations > 0 ? (
          <div className="rounded-2xl bg-periwinkle/20 px-4 py-3 text-xs text-indigo-950" data-testid="locked-note">
            {liveRegistrations} registration{liveRegistrations === 1 ? "" : "s"} exist. The fee and existing questions are
            locked so current answers stay valid. You can still add optional questions, change dates, and switch waiver
            versions (new signers sign the new one).
          </div>
        ) : null}

        <Card>
          <CardHeader title="Details" description={`Season for ${program.name}`} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Season name" className="sm:col-span-2">
              <Input name="name" required maxLength={120} defaultValue={season?.name ?? ""} placeholder="Spring 2027" />
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <Textarea name="description" rows={3} maxLength={2000} defaultValue={season?.description ?? ""} />
            </Field>
            <Field label="Season starts">
              <Input type="date" name="startsOn" defaultValue={season?.startsOn ?? ""} />
            </Field>
            <Field label="Season ends">
              <Input type="date" name="endsOn" defaultValue={season?.endsOn ?? ""} />
            </Field>
            <Field
              label="Fee (USD)"
              hint={feeLocked ? "Locked: registrations already snapshot this fee." : "Use 0 for a free season."}
            >
              <Input
                name="feeDollars"
                inputMode="decimal"
                defaultValue={season ? (season.baseFeeCents / 100).toFixed(2) : "0.00"}
                readOnly={feeLocked}
                className={feeLocked ? "opacity-60" : undefined}
              />
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2.5 text-sm font-medium text-charcoal">
                <Switch name="isActive" defaultChecked={season?.isActive ?? true} />
                Season active
              </label>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Registration window and eligibility"
            description="Times are Pacific. Eligibility is by date of birth, inclusive."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Registration opens" hint="Needs a waiver. Leave blank to keep the season a draft.">
              <Input
                type="datetime-local"
                name="registrationOpensAt"
                value={opens}
                onChange={(e) => setOpens(e.target.value)}
              />
            </Field>
            <Field label="Registration closes" hint="Optional.">
              <Input
                type="datetime-local"
                name="registrationClosesAt"
                defaultValue={season?.registrationClosesAt ? utcToLaDateTimeInput(season.registrationClosesAt) : ""}
              />
            </Field>
            <Field label="Born on or after" hint="Optional. Earliest eligible birth date.">
              <Input type="date" name="eligibleBirthDateFrom" defaultValue={season?.eligibleBirthDateFrom ?? ""} />
            </Field>
            <Field label="Born on or before" hint="Optional. Latest eligible birth date.">
              <Input type="date" name="eligibleBirthDateTo" defaultValue={season?.eligibleBirthDateTo ?? ""} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Waiver"
            description="Families e-sign this exact version. Versions can't be edited, only replaced."
            action={
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(true)}>
                <Plus className="h-4 w-4" /> New waiver version
              </Button>
            }
          />
          <div className="space-y-3">
            <Field label="Waiver version">
              <Select name="waiverVersionId" value={waiverId} onChange={(e) => setWaiverId(e.target.value)}>
                <option value="">No waiver yet</option>
                {waivers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title} - {w.version}
                    {w.programId === null ? " (org-wide)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {opens && !waiverId ? (
              <p className="text-xs font-medium text-rose-700">Choose a waiver before setting a registration opening date.</p>
            ) : null}
            {selectedWaiver ? (
              <div>
                <p className="mb-1 text-xs text-stone-500">
                  Saved {formatDateTime(selectedWaiver.createdAt)}
                  {selectedWaiver.createdByName ? ` by ${selectedWaiver.createdByName}` : ""} - hash{" "}
                  <span className="font-mono">{selectedWaiver.bodyHash.slice(0, 12)}</span>
                </p>
                <pre
                  tabIndex={0}
                  className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-line bg-alabaster p-4 font-sans text-xs text-charcoal"
                  data-testid="waiver-body"
                >
                  {selectedWaiver.body}
                </pre>
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Registration form" description="Questions families answer, with a live preview on the right." />
          <div className="grid gap-6 lg:grid-cols-2">
            <FormBuilder fields={fields} onChange={setFields} lockedKeys={lockedKeys} />
            <div className="min-w-0">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400">Live preview</h3>
              <div className="rounded-2xl border border-line bg-white p-4">
                <FormPreview fields={definition} />
              </div>
            </div>
          </div>
        </Card>

        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2.5">
          <Link href={`/programs/${program.slug}`} className={buttonStyles({ variant: "ghost" })}>
            Cancel
          </Link>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : isEdit ? "Save season" : "Create season"}
          </Button>
        </div>
      </form>

      <WaiverVersionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={onWaiverCreated}
        programId={program.id}
        programName={program.name}
        canOrgWide={canOrgWideWaiver}
        suggestedVersion={suggestedVersion}
      />
    </>
  );
}
