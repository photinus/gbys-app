"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { CustomFormField } from "@/lib/custom-form";
import type { ContactSubmitResult } from "@/lib/validation/contact-submit";

type Action = (prev: ContactSubmitResult | null, formData: FormData) => Promise<ContactSubmitResult>;

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

const reqMark = <span className="text-rose-700"> *</span>;

export function ContactForm({
  action,
  slug,
  siteKey,
  collectPhone,
  phoneRequired,
  fields,
  submitLabel,
  successMessage,
  privacyNote,
  compact = false,
}: {
  action: Action;
  slug: string;
  siteKey: string;
  collectPhone: boolean;
  phoneRequired: boolean;
  fields: CustomFormField[];
  submitLabel: string;
  successMessage: string;
  privacyNote: string | null;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null as ContactSubmitResult | null);
  const [token, setToken] = useState("");
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const success = state?.ok === true;

  useEffect(() => {
    if (success) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !widgetRef.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(widgetRef.current, {
          sitekey: siteKey,
          size: "flexible",
          callback: (t: string) => {
            setToken(t);
            setWidgetError(null);
          },
          "expired-callback": () => setToken(""),
          "error-callback": () => {
            setToken("");
            setWidgetError("The human check failed to load. Reload the page and try again.");
          },
        });
      })
      .catch(() => setWidgetError("The human check could not be loaded. Check your connection and reload."));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [siteKey, success]);

  // A token is single-use: refresh it after every failed submit.
  useEffect(() => {
    if (state && !state.ok && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      setToken("");
    }
  }, [state]);

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      if (!token) {
        setLocalError("Please complete the human check below before sending.");
        return;
      }
      setLocalError(null);
      const answers: Record<string, string | boolean> = {};
      for (const f of fields) {
        answers[f.key] = f.type === "checkbox" ? fd.get(`a__${f.key}`) === "on" : String(fd.get(`a__${f.key}`) ?? "");
      }
      fd.set("answers", JSON.stringify(answers));
      fd.set("cf-turnstile-response", token);
      fd.set("referrer", document.referrer || "");
      startTransition(() => formAction(fd));
    },
    [fields, formAction, token]
  );

  if (success) {
    return (
      <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-5 text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <p className="whitespace-pre-line break-words text-sm font-medium">{state.data.successMessage || successMessage}</p>
      </div>
    );
  }

  const errs = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const topError = localError ?? (state && !state.ok ? state.error : null) ?? widgetError;

  return (
    <form onSubmit={onSubmit} noValidate className={compact ? "space-y-3" : "space-y-4"}>
      <input type="hidden" name="slug" value={slug} />
      <Field label={<>Your name{reqMark}</>} error={errs.name}>
        <Input name="name" autoComplete="name" required maxLength={120} />
      </Field>
      <Field label={<>Email{reqMark}</>} error={errs.email}>
        <Input name="email" type="email" autoComplete="email" required maxLength={254} />
      </Field>
      {collectPhone ? (
        <Field label={<>Phone{phoneRequired ? reqMark : <span className="font-normal text-stone-400"> (optional)</span>}</>} error={errs.phone}>
          <Input name="phone" type="tel" autoComplete="tel" inputMode="tel" required={phoneRequired} maxLength={40} />
        </Field>
      ) : null}
      {fields.map((f) => {
        const label = (
          <>
            {f.label}
            {f.required ? reqMark : null}
          </>
        );
        const error = errs[`answers.${f.key}`];
        const name = `a__${f.key}`;
        if (f.type === "checkbox") {
          return (
            <div key={f.key}>
              <label className="flex items-start gap-3 text-sm text-charcoal">
                <input type="checkbox" name={name} className="mt-0.5 h-4 w-4 shrink-0 accent-charcoal" aria-invalid={error ? true : undefined} />
                <span>{label}</span>
              </label>
              {error ? (
                <p role="alert" className="mt-1 text-xs font-medium text-rose-700">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }
        return (
          <Field key={f.key} label={label} error={error}>
            {f.type === "textarea" ? (
              <Textarea name={name} placeholder={f.placeholder} maxLength={2000} />
            ) : f.type === "select" ? (
              <Select name={name} defaultValue="">
                <option value="">Choose...</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            ) : f.type === "number" ? (
              <Input name={name} type="number" inputMode="decimal" placeholder={f.placeholder} />
            ) : (
              <Input name={name} placeholder={f.placeholder} maxLength={200} />
            )}
          </Field>
        );
      })}
      <Field label={<>Message{reqMark}</>} error={errs.message}>
        <Textarea name="message" rows={compact ? 4 : 6} required maxLength={5000} />
      </Field>

      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Leave this field empty
          <input type="text" name="hp_url" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div ref={widgetRef} className="min-h-[65px]" />

      <p role="alert" aria-live="assertive" className={topError ? "text-sm font-medium text-rose-700" : "sr-only"}>
        {topError ?? ""}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending..." : submitLabel}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {pending ? "Sending your message" : ""}
        </span>
      </div>
      {privacyNote ? <p className="whitespace-pre-line break-words text-xs text-stone-500">{privacyNote}</p> : null}
    </form>
  );
}
