"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { removeImageAction, saveLookAction, uploadImageAction } from "@/app/(portal)/programs/[slug]/home-page/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Modal, useToast } from "@/components/ui";
import { ACCENT_PRESETS, accentIsAccessible, contrastRatio, normalizeHex, readableTextOn } from "@/lib/color";
import { ACCENT_ERROR, IMAGE_MAX_BYTES } from "@/lib/validation/program-sites";

export function AccentForm({ programId, accentColor }: { programId: string; accentColor: string }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(saveLookAction);
  const [text, setText] = useState(accentColor);
  useEffect(() => {
    if (state?.ok) toast.success(state.data.changed.length ? "Color saved" : "No changes to save");
  }, [state, toast]);

  const hex = normalizeHex(text);
  const accessible = hex ? accentIsAccessible(hex) : false;
  const on = hex ? readableTextOn(hex) : "#111827";
  const ratio = hex ? contrastRatio(hex, on) : 0;
  const error = !hex ? "Enter a color like #1d4ed8 (six hex digits)." : !accessible ? ACCENT_ERROR : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm" data-testid="accent-form">
      <input type="hidden" name="programId" value={programId} />
      <input type="hidden" name="accentColor" value={hex ?? ""} />
      <div>
        <span className="mb-1 block text-xs font-semibold text-stone-600">Accent color</span>
        <div className="grid grid-cols-5 gap-2 sm:grid-cols-10" role="radiogroup" aria-label="Accent color presets">
          {ACCENT_PRESETS.map((p) => {
            const selected = hex === p.hex;
            return (
              <button
                key={p.hex}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={p.name}
                title={p.name}
                data-testid={`preset-${p.name.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => setText(p.hex)}
                className="flex h-10 w-full items-center justify-center rounded-xl border border-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle"
                style={{ backgroundColor: p.hex, color: readableTextOn(p.hex) }}
              >
                {selected ? <Check className="h-4 w-4" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Or enter your own" hint="Six-digit hex code, like #0f766e. Colors that make white or dark text hard to read are not allowed.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick a color"
              value={hex ?? "#4f46e5"}
              onChange={(e) => setText(e.target.value)}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1"
            />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              aria-label="Custom accent color"
              data-testid="accent-text"
              aria-invalid={error ? true : undefined}
            />
          </div>
        </Field>
        <div className="rounded-2xl border border-line bg-alabaster p-4" aria-live="polite">
          <p className="mb-2 text-xs font-semibold text-stone-600">Preview</p>
          <span
            data-testid="accent-swatch"
            className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ backgroundColor: hex ?? "#e7e5e4", color: on }}
          >
            Register now
          </span>
          <p className="mt-2 text-xs text-stone-500" data-testid="accent-contrast">
            {hex ? `Contrast ${ratio.toFixed(1)}:1 ${accessible ? "(easy to read)" : "(too low)"}` : "Not a valid color yet"}
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" data-testid="accent-error" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
      <FormError state={state} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !!error} data-testid="save-accent">
          {pending ? "Saving..." : "Save color"}
        </Button>
      </div>
    </form>
  );
}

export function ImageUploader({
  programId,
  kind,
  title,
  help,
  initialUrl,
}: {
  programId: string;
  kind: "hero" | "logo";
  title: string;
  help: string;
  initialUrl: string | null;
}) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useActionForm(uploadImageAction);
  const [url, setUrl] = useState(initialUrl);
  const [clientError, setClientError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success(`${title} updated`);
      setUrl((state.data as { url: string }).url);
      formRef.current?.reset();
    }
  }, [state, toast, title]);

  function check(e: React.FormEvent<HTMLFormElement>) {
    const file = new FormData(e.currentTarget).get("file");
    if (!(file instanceof File) || file.size === 0) {
      e.preventDefault();
      setClientError("Choose an image file first.");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      e.preventDefault();
      setClientError("That file is over 5 MB. Choose a smaller image.");
      return;
    }
    setClientError(null);
    onSubmit(e);
  }

  async function remove() {
    setRemoving(true);
    setRemoveError(null);
    const res = await removeImageAction(programId, kind);
    setRemoving(false);
    if (res.ok) {
      setConfirmRemove(false);
      setUrl(null);
      toast.success(`${title} removed`);
    } else setRemoveError(res.error);
  }

  return (
    <div className="space-y-3 text-sm" data-testid={`${kind}-uploader`}>
      <h3 className="text-sm font-bold text-charcoal">{title}</h3>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line bg-alabaster ${kind === "hero" ? "h-24 w-40" : "h-24 w-24"}`}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={`Current ${title.toLowerCase()}`} className="h-full w-full object-cover" data-testid={`${kind}-preview`} />
          ) : (
            <span className="px-2 text-center text-xs text-stone-400">None yet</span>
          )}
        </div>
        <p className="min-w-0 flex-1 text-xs text-stone-500">{help}</p>
      </div>
      <form ref={formRef} onSubmit={check} className="space-y-3">
        <input type="hidden" name="programId" value={programId} />
        <input type="hidden" name="kind" value={kind} />
        <Field label={url ? "Replace image" : "Upload an image"}>
          <input
            type="file"
            name="file"
            accept="image/png,image/jpeg,image/webp"
            data-testid={`${kind}-file`}
            className="block w-full max-w-full text-sm text-stone-600 file:mr-3 file:rounded-full file:border-0 file:bg-alabaster file:px-4 file:py-2 file:text-xs file:font-semibold file:text-charcoal"
          />
        </Field>
        {clientError ? (
          <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
            {clientError}
          </p>
        ) : null}
        <FormError state={state} />
        <div className="flex flex-wrap justify-end gap-2.5">
          {url ? (
            <Button variant="danger" onClick={() => setConfirmRemove(true)} data-testid={`${kind}-remove`}>
              Remove
            </Button>
          ) : null}
          <Button type="submit" disabled={pending} data-testid={`${kind}-upload`}>
            {pending ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </form>
      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Remove ${title.toLowerCase()}?`}
        description={kind === "hero" ? "The page will use a plain color background instead." : "The page will show the program name without a logo."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} disabled={removing} data-testid={`${kind}-remove-confirm`}>
              {removing ? "Removing..." : "Remove"}
            </Button>
          </>
        }
      >
        {removeError ? (
          <p role="alert" className="text-xs font-medium text-rose-900">
            {removeError}
          </p>
        ) : (
          <p className="text-sm text-stone-600">You can upload a new one any time.</p>
        )}
      </Modal>
    </div>
  );
}
