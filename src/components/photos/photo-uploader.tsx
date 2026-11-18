"use client";

import { Camera, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui";
import type { ActionResult } from "@/lib/dal/context";
import { PhotoAvatar } from "./photo-avatar";

export const MAX_PHOTO_MB = 8;
const MAX_BYTES = MAX_PHOTO_MB * 1024 * 1024;

/**
 * "Add photo" / "Change photo" control with a preview. Server actions receive
 * FormData (field "photo"); the server validates content and size again.
 */
export function PhotoUploader({
  name,
  currentUrl,
  size = "xl",
  removable,
  upload,
  remove,
  onChanged,
}: {
  name: string;
  currentUrl: string | null;
  size?: "lg" | "xl";
  /** Whether an uploaded photo exists to remove (a provider picture is not removable). Defaults to `currentUrl`. */
  removable?: boolean;
  upload: (fd: FormData) => Promise<ActionResult<{ url: string }>>;
  remove: () => Promise<ActionResult>;
  onChanged?: (url: string | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(currentUrl);
  const [canRemove, setCanRemove] = useState<boolean>(removable ?? !!currentUrl);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function reset() {
    setFile(null);
    if (input.current) input.current.value = "";
  }

  function onPick(f: File | undefined) {
    setError(null);
    setNotice(null);
    if (!f) return reset();
    if (f.size > MAX_BYTES) {
      setError(`That photo is ${(f.size / 1048576).toFixed(1)} MB. Photos must be ${MAX_PHOTO_MB} MB or smaller.`);
      return reset();
    }
    if (f.type && !f.type.startsWith("image/")) {
      setError("Choose an image file.");
      return reset();
    }
    setFile(f);
  }

  function save() {
    if (!file) return;
    const fd = new FormData();
    fd.set("photo", file);
    startTransition(async () => {
      const res = await upload(fd);
      if (res.ok) {
        setUrl(res.data.url);
        setCanRemove(true);
        onChanged?.(res.data.url);
        setNotice("Photo saved.");
        reset();
      } else setError(res.error);
    });
  }

  function doRemove() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await remove();
      if (res.ok) {
        setUrl(null);
        setCanRemove(false);
        onChanged?.(null);
        setNotice("Photo removed.");
        reset();
      } else setError(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <PhotoAvatar name={name} src={preview ?? url} size={size} />
      <div className="min-w-0 space-y-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label={`${url ? "Change" : "Add"} photo for ${name}`}
          data-testid="photo-input"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          {file ? (
            <>
              <Button size="sm" onClick={save} disabled={pending} data-testid="photo-save">
                {pending ? "Saving..." : "Save photo"}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={pending}>
                <Camera className="h-4 w-4" /> {url ? "Change photo" : "Add photo"}
              </Button>
              {canRemove ? (
                <Button size="sm" variant="ghost" onClick={doRemove} disabled={pending}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              ) : null}
            </>
          )}
        </div>
        <p className="text-xs text-stone-500">JPEG, PNG, WEBP or HEIC, up to {MAX_PHOTO_MB} MB.</p>
        {error ? (
          <p role="alert" className="text-xs font-medium text-rose-800">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-xs font-medium text-emerald-800">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}
