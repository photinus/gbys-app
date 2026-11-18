"use client";

import type { KeyboardEvent } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import type { CustomFormField } from "@/lib/custom-form";

/**
 * Renders a season form the way families will see it. Inputs are unnamed and
 * Enter is swallowed so the preview never submits the surrounding editor form.
 */
export function FormPreview({ fields }: { fields: Pick<CustomFormField, "key" | "label" | "type" | "required" | "options" | "placeholder">[] }) {
  const swallowEnter = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault();
  };
  if (fields.length === 0) {
    return <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-stone-500">No questions yet. Families will only see the waiver.</p>;
  }
  return (
    <div className="space-y-4" onKeyDown={swallowEnter} data-testid="form-preview">
      {fields.map((f) => {
        const label = (
          <>
            {f.label || <span className="text-stone-400">Untitled field</span>}
            {f.required ? <span className="text-rose-600"> *</span> : null}
          </>
        );
        if (f.type === "checkbox") {
          return (
            <label key={f.key} className="flex items-start gap-2.5 text-sm text-charcoal">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line accent-charcoal" />
              <span>{label}</span>
            </label>
          );
        }
        return (
          <Field key={f.key} label={label}>
            {f.type === "textarea" ? (
              <Textarea rows={3} placeholder={f.placeholder} />
            ) : f.type === "select" ? (
              <Select defaultValue="">
                <option value="" disabled>
                  {f.placeholder || "Choose..."}
                </option>
                {(f.options ?? []).map((o, i) => (
                  <option key={`${o}-${i}`} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input type={f.type === "number" ? "number" : "text"} placeholder={f.placeholder} />
            )}
          </Field>
        );
      })}
    </div>
  );
}
