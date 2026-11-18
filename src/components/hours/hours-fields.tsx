"use client";

import { useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABELS, VOLUNTEER_CATEGORIES, type VolunteerCategory } from "@/lib/volunteer-categories";
import { MAX_DESCRIPTION } from "@/lib/validation/hours";

export interface ProgramChoice {
  id: string;
  name: string;
}

/** A volunteer role assignment the hours can be logged against. */
export interface RoleChoice {
  id: string;
  label: string;
  programId: string | null;
  category: VolunteerCategory;
  /** Term bounds as LA dates (inclusive), null when unknown. */
  termMin: string | null;
  termMax: string | null;
  /** Board picker only: fills the volunteer email field. */
  volunteerEmail?: string;
}

// Large touch targets, 16px text (prevents iOS zoom-on-focus).
const big = "py-3 text-base";

/** Shared fields for the self-report form and the board "log for a volunteer" modal. */
export function HoursFields({
  programs,
  today,
  minDate,
  disabled,
  withEmail,
  roles = [],
  defaultRoleId = "",
}: {
  programs: ProgramChoice[];
  today: string;
  minDate: string;
  disabled?: boolean;
  withEmail?: boolean;
  roles?: RoleChoice[];
  defaultRoleId?: string;
}) {
  const initialRole = roles.find((r) => r.id === defaultRoleId);
  const [roleId, setRoleId] = useState(initialRole?.id ?? "");
  const [programId, setProgramId] = useState(initialRole ? (initialRole.programId ?? "") : "");
  const [category, setCategory] = useState<VolunteerCategory>(initialRole?.category ?? "coaching");
  const [email, setEmail] = useState(initialRole?.volunteerEmail ?? "");
  const role = roles.find((r) => r.id === roleId);

  const dateMin = role?.termMin && role.termMin > minDate ? role.termMin : minDate;
  const dateMax = role?.termMax && role.termMax < today ? role.termMax : today;
  const [date, setDate] = useState(today);
  // Keep the date inside the role's term so the browser does not block the submit silently.
  const shownDate = date < dateMin ? dateMin : date > dateMax ? dateMax : date;

  function pickRole(id: string) {
    setRoleId(id);
    const r = roles.find((x) => x.id === id);
    if (r) {
      setProgramId(r.programId ?? "");
      setCategory(r.category);
      if (r.volunteerEmail) setEmail(r.volunteerEmail);
    }
  }

  return (
    <div className="space-y-4">
      {roles.length > 0 ? (
        <Field
          label="Volunteer role (optional)"
          hint={
            withEmail
              ? "Pick a role to fill in the volunteer, program and category. Hours count toward that role."
              : "Choosing a role fills in the program and category, and counts these hours toward the role."
          }
        >
          <Select
            name="volunteerRoleAssignmentId"
            value={roleId}
            onChange={(e) => pickRole(e.target.value)}
            disabled={disabled}
            className={big}
          >
            <option value="">No role (general hours)</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {withEmail ? (
        <Field label="Volunteer email" hint="They must have signed in at least once.">
          <Input
            type="email"
            name="email"
            required
            autoComplete="off"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={!!role?.volunteerEmail}
            disabled={disabled}
            className={big}
          />
        </Field>
      ) : null}
      <Field
        label="Date"
        hint={
          role && (role.termMin || role.termMax)
            ? "Must fall within the role's term, and not in the future."
            : "Within the last 365 days, not in the future."
        }
      >
        <Input
          type="date"
          name="activityDate"
          value={shownDate}
          onChange={(e) => setDate(e.target.value)}
          min={dateMin}
          max={dateMax}
          required
          disabled={disabled}
          className={big}
        />
      </Field>
      <div>
        <span className="mb-1 block text-xs font-semibold text-stone-600" id="duration-label">
          Time volunteered
        </span>
        <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="duration-label">
          <Select name="hours" defaultValue="1" aria-label="Hours" disabled={disabled} className={big}>
            {Array.from({ length: 25 }, (_, h) => (
              <option key={h} value={h}>
                {h} {h === 1 ? "hour" : "hours"}
              </option>
            ))}
          </Select>
          <Select name="minutes" defaultValue="0" aria-label="Minutes" disabled={disabled} className={big}>
            {[0, 15, 30, 45].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </Select>
        </div>
        <p className="mt-1 text-xs text-stone-400">In 15-minute steps, up to 24 hours.</p>
      </div>
      <Field label="Program" hint={role ? "Set by the role you chose." : undefined}>
        <Select
          name={role ? undefined : "programId"}
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          disabled={disabled || !!role}
          className={big}
        >
          <option value="">Organization / board (no program)</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      {role ? <input type="hidden" name="programId" value={programId} /> : null}
      <Field label="Category">
        <Select
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as VolunteerCategory)}
          disabled={disabled}
          className={big}
        >
          {VOLUNTEER_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="What did you do?" hint={`Required, up to ${MAX_DESCRIPTION} characters.`}>
        <Textarea
          name="description"
          rows={3}
          required
          maxLength={MAX_DESCRIPTION}
          placeholder="e.g. Ran Tuesday practice and set up the field"
          disabled={disabled}
          className={big}
        />
      </Field>
    </div>
  );
}
