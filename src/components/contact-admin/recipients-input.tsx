"use client";

import { X } from "lucide-react";
import { useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Field, Input } from "@/components/ui";
import { CONTACT_MAX_RECIPIENTS } from "@/lib/validation/contact-forms";

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Chips input for recipient emails: Enter, comma, space or blur adds; paste splits. Lowercases and de-duplicates. */
export function RecipientsInput({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (raw: string): boolean => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return true;
    const next = [...value];
    for (const p of parts) {
      if (!EMAIL_RE.test(p) || p.length > 254) {
        setError(`"${p}" isn't a valid email address.`);
        setDraft(parts.filter((x) => !next.includes(x)).join(", "));
        onChange(next);
        return false;
      }
      if (next.includes(p)) continue;
      if (next.length >= CONTACT_MAX_RECIPIENTS) {
        setError(`At most ${CONTACT_MAX_RECIPIENTS} recipients.`);
        onChange(next);
        return false;
      }
      next.push(p);
    }
    setError(null);
    setDraft("");
    onChange(next);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === ";") {
      if (draft.trim()) {
        e.preventDefault();
        add(draft);
      } else if (e.key === "Enter") {
        e.preventDefault();
      }
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/[\s,;]/.test(text.trim())) {
      e.preventDefault();
      add(text);
    }
  };

  return (
    <div className="space-y-2">
      <Field
        label="Recipient emails"
        hint={`Each message is emailed to these addresses (up to ${CONTACT_MAX_RECIPIENTS}). Replies go to the sender.`}
        error={error}
      >
        <Input
          type="text"
          inputMode="email"
          autoComplete="off"
          value={draft}
          disabled={disabled}
          placeholder="name@example.org, then Enter"
          data-testid="recipient-draft"
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            if (draft.trim()) add(draft);
          }}
        />
      </Field>
      {value.length ? (
        <ul className="flex flex-wrap gap-2" data-testid="recipient-chips" aria-label="Recipients">
          {value.map((e) => (
            <li key={e} className="inline-flex max-w-full items-center gap-1 rounded-full bg-periwinkle/25 py-1 pl-3 pr-1 text-xs font-medium text-indigo-950">
              <span className="truncate">{e}</span>
              <button
                type="button"
                aria-label={`Remove ${e}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((x) => x !== e))}
                className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/60"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
