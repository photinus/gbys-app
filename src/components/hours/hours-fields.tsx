"use client";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABELS, VOLUNTEER_CATEGORIES } from "@/lib/volunteer-categories";
import { MAX_DESCRIPTION } from "@/lib/validation/hours";

export interface ProgramChoice {
  id: string;
  name: string;
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
}: {
  programs: ProgramChoice[];
  today: string;
  minDate: string;
  disabled?: boolean;
  withEmail?: boolean;
}) {
  return (
    <div className="space-y-4">
      {withEmail ? (
        <Field label="Volunteer email" hint="They must have signed in at least once.">
          <Input
            type="email"
            name="email"
            required
            autoComplete="off"
            inputMode="email"
            disabled={disabled}
            className={big}
          />
        </Field>
      ) : null}
      <Field label="Date" hint="Within the last 365 days, not in the future.">
        <Input
          type="date"
          name="activityDate"
          defaultValue={today}
          min={minDate}
          max={today}
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
      <Field label="Program">
        <Select name="programId" defaultValue="" disabled={disabled} className={big}>
          <option value="">Organization / board (no program)</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Category">
        <Select name="category" defaultValue="coaching" disabled={disabled} className={big}>
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
