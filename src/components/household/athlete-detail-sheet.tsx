"use client";

import { HeartPulse, Pencil, Phone, ShieldCheck } from "lucide-react";
import { Badge, Button, Sheet } from "@/components/ui";
import type { ActionResult } from "@/lib/dal/context";
import type { AthleteDetail, AthleteListItem } from "@/lib/dal/households";
import { formatDob } from "@/lib/format";
import { formatPhone } from "@/lib/validation/household";
import { ageFromDob } from "./age";
import { PhotoAvatar } from "@/components/photos/photo-avatar";
import { PhotoUploader } from "@/components/photos/photo-uploader";
import { removeAthletePhotoAction, uploadAthletePhotoAction } from "@/app/(portal)/household/actions";

export type DetailState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; detail: AthleteDetail };

export function detailStateFromResult(res: ActionResult<AthleteDetail>): DetailState {
  return res.ok ? { status: "ready", detail: res.data } : { status: "error", error: res.error };
}

export function AthleteDetailSheet({
  open,
  onClose,
  athlete,
  state,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  athlete: AthleteListItem | null;
  state: DetailState;
  onEdit: (detail: AthleteDetail) => void;
}) {
  const detail = state.status === "ready" ? state.detail : null;
  const title = athlete ? `${athlete.firstName} ${athlete.lastName}` : "Athlete";
  const age = athlete ? ageFromDob(athlete.dateOfBirth) : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={
        athlete
          ? `${formatDob(athlete.dateOfBirth)}${age !== null ? ` (age ${age})` : ""}${athlete.gradeLevel ? ` - Grade ${athlete.gradeLevel}` : ""}`
          : undefined
      }
      footer={
        detail?.canEdit ? (
          <Button variant="secondary" onClick={() => onEdit(detail)}>
            <Pencil className="h-4 w-4" /> Edit athlete
          </Button>
        ) : null
      }
    >
      {state.status === "loading" ? (
        <p className="text-sm text-stone-500" role="status">
          Loading secure details...
        </p>
      ) : state.status === "error" ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-sm font-medium text-rose-900">
          {state.error}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-stone-600">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
            Viewing medical and emergency details is recorded in the audit log.
          </div>

          <section data-testid="athlete-photo">
            {state.detail.canEdit ? (
              <PhotoUploader
                key={`${state.detail.id}-${state.detail.photoUrl ?? "none"}`}
                name={title}
                currentUrl={state.detail.photoUrl}
                upload={(fd) => uploadAthletePhotoAction(state.detail.id, fd)}
                remove={() => removeAthletePhotoAction(state.detail.id)}
              />
            ) : (
              <PhotoAvatar name={title} src={state.detail.photoUrl} size="xl" />
            )}
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-charcoal">
              <HeartPulse className="h-4 w-4 text-rose-500" /> Medical notes
            </h4>
            {state.detail.medicalNotes ? (
              <p className="whitespace-pre-wrap rounded-2xl border border-coral/40 bg-coral/15 p-4 text-sm leading-relaxed text-charcoal">
                {state.detail.medicalNotes}
              </p>
            ) : (
              <p className="rounded-2xl bg-alabaster p-4 text-sm text-stone-500">No medical alerts on file.</p>
            )}
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-charcoal">
              <Phone className="h-4 w-4 text-indigo-600" /> Emergency contacts
            </h4>
            <ul className="space-y-2">
              {state.detail.emergencyContacts.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-charcoal">{c.name}</p>
                    <Badge tone="neutral" className="mt-1">
                      {c.relationship}
                    </Badge>
                  </div>
                  <a
                    href={`tel:${c.phone}`}
                    className="shrink-0 text-sm font-semibold text-charcoal underline decoration-line underline-offset-4"
                  >
                    {formatPhone(c.phone)}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-alabaster p-3.5">
              <p className="text-xs text-stone-500">Gender</p>
              <p className="font-semibold text-charcoal">{state.detail.gender ?? "Not specified"}</p>
            </div>
            <div className="rounded-2xl bg-alabaster p-3.5">
              <p className="text-xs text-stone-500">Grade</p>
              <p className="font-semibold text-charcoal">{state.detail.gradeLevel ?? "Not specified"}</p>
            </div>
          </section>
        </>
      )}
    </Sheet>
  );
}
