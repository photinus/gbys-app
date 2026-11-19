"use client";

import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Switch, Textarea } from "@/components/ui";
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FORM_TEMPLATES,
  type CustomFormField,
} from "@/lib/custom-form";

export const MAX_FIELDS = 25;

/** Editable field state. `uid` is a stable React key; `keyTouched` stops label->key auto-sync. */
export interface BuilderField {
  uid: string;
  key: string;
  keyTouched: boolean;
  label: string;
  type: CustomFormField["type"];
  required: boolean;
  optionsText: string;
  placeholder: string;
}

let counter = 0;
const newUid = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`;

export function toBuilderFields(fields: CustomFormField[]): BuilderField[] {
  return fields.map((f) => ({
    uid: newUid(),
    key: f.key,
    keyTouched: true,
    label: f.label,
    type: f.type,
    required: f.required,
    optionsText: (f.options ?? []).join("\n"),
    placeholder: f.placeholder ?? "",
  }));
}

export function toDefinition(fields: BuilderField[]): CustomFormField[] {
  return fields.map((f) => {
    const def: CustomFormField = { key: f.key, label: f.label.trim(), type: f.type, required: f.required };
    if (f.type === "select") {
      def.options = f.optionsText
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean);
    }
    const ph = f.placeholder.trim();
    if (ph && f.type !== "checkbox" && f.type !== "select") def.placeholder = ph;
    return def;
  });
}

export function keyFromLabel(label: string, taken: Set<string>): string {
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 34);
  if (!base) base = "field";
  if (!/^[a-z]/.test(base)) base = `f_${base}`;
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

export function blankField(existing: BuilderField[]): BuilderField {
  const taken = new Set(existing.map((f) => f.key));
  return {
    uid: newUid(),
    key: keyFromLabel("", taken),
    keyTouched: false,
    label: "",
    type: "text",
    required: false,
    optionsText: "",
    placeholder: "",
  };
}

export function FormBuilder({
  fields,
  onChange,
  lockedKeys,
  disabled,
  maxFields = MAX_FIELDS,
}: {
  fields: BuilderField[];
  onChange: (fields: BuilderField[]) => void;
  /** Keys that already have registration answers: can't be removed, renamed or retyped. */
  lockedKeys: Set<string>;
  disabled?: boolean;
  /** Field cap shown and enforced by the Add button (defaults to 25; contact forms use 15). */
  maxFields?: number;
}) {
  const locked = lockedKeys.size > 0;
  const update = (uid: string, patch: Partial<BuilderField>) =>
    onChange(
      fields.map((f) => {
        if (f.uid !== uid) return f;
        const next = { ...f, ...patch };
        if (patch.label !== undefined && !f.keyTouched) {
          const taken = new Set(fields.filter((o) => o.uid !== uid).map((o) => o.key));
          next.key = keyFromLabel(patch.label, taken);
        }
        return next;
      })
    );
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const copy = [...fields];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  const applyTemplate = (id: string) => {
    const t = CUSTOM_FORM_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (fields.length > 0 && !window.confirm("Replace the current questions with this template?")) return;
    onChange(toBuilderFields(t.fields));
  };

  return (
    <div className="space-y-4">
      {!disabled ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field
            label="Start from template"
            hint={locked ? "Templates are unavailable once registrations exist." : "Replaces the current questions."}
            className="sm:w-72"
          >
            <Select
              value=""
              disabled={locked}
              onChange={(e) => {
                applyTemplate(e.target.value);
              }}
              data-testid="template-select"
            >
              <option value="">Choose a template...</option>
              {CUSTOM_FORM_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      {fields.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-stone-500">
          No questions yet. Add a field or start from a template.
        </p>
      ) : null}

      <ol className="space-y-3">
        {fields.map((f, i) => {
          const isLocked = lockedKeys.has(f.key) && f.keyTouched;
          return (
            <li key={f.uid} data-testid="builder-field" className="rounded-2xl border border-line bg-white p-4">
              <div className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                  <Field label="Label" className="sm:col-span-2">
                    <Input
                      value={f.label}
                      maxLength={120}
                      disabled={disabled}
                      placeholder="e.g. Jersey size"
                      onChange={(e) => update(f.uid, { label: e.target.value })}
                      aria-label={`Field ${i + 1} label`}
                    />
                  </Field>
                  <Field label="Type">
                    <Select
                      value={f.type}
                      disabled={disabled || isLocked}
                      onChange={(e) => update(f.uid, { type: e.target.value as BuilderField["type"] })}
                    >
                      {CUSTOM_FIELD_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {CUSTOM_FIELD_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label={
                      <span className="inline-flex items-center gap-1">
                        Key {isLocked ? <Lock className="h-3 w-3" aria-label="Locked" /> : null}
                      </span>
                    }
                    hint={isLocked ? "Locked: registrations already use this key." : "Identifies answers; set once."}
                  >
                    <Input
                      value={f.key}
                      maxLength={40}
                      disabled={disabled || isLocked}
                      className="font-mono text-xs"
                      onChange={(e) => update(f.uid, { key: e.target.value, keyTouched: true })}
                    />
                  </Field>
                  {f.type === "select" ? (
                    <Field label="Options" hint="One per line (at least two)." className="sm:col-span-2">
                      <Textarea
                        rows={3}
                        value={f.optionsText}
                        disabled={disabled}
                        onChange={(e) => update(f.uid, { optionsText: e.target.value })}
                      />
                    </Field>
                  ) : null}
                  {f.type !== "checkbox" && f.type !== "select" ? (
                    <Field label="Placeholder (optional)" className="sm:col-span-2">
                      <Input
                        value={f.placeholder}
                        maxLength={120}
                        disabled={disabled}
                        onChange={(e) => update(f.uid, { placeholder: e.target.value })}
                      />
                    </Field>
                  ) : null}
                  <label className="flex items-center gap-2.5 text-sm font-medium text-charcoal sm:col-span-2">
                    <Switch
                      checked={f.required}
                      disabled={disabled}
                      onChange={(e) => update(f.uid, { required: e.target.checked })}
                      aria-label={`Field ${i + 1} required`}
                    />
                    Required
                  </label>
                </div>
                {!disabled ? (
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Move down"
                      disabled={i === fields.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove field"
                      title={isLocked ? "Can't remove: registrations already answered this field" : "Remove field"}
                      disabled={isLocked}
                      onClick={() => onChange(fields.filter((o) => o.uid !== f.uid))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {!disabled ? (
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={fields.length >= maxFields}
            onClick={() => onChange([...fields, blankField(fields)])}
          >
            <Plus className="h-4 w-4" /> Add field
          </Button>
          <span className="text-xs text-stone-400">
            {fields.length} of {maxFields}
          </span>
        </div>
      ) : null}
    </div>
  );
}
