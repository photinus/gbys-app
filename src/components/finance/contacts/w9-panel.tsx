"use client";

import { FileText, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { removeW9Action, uploadW9Action } from "@/app/(portal)/finance/contacts/actions";
import { useRunner } from "@/components/finance/banking/use-runner";
import { fileSize } from "@/components/finance/payables/shared";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, useToast } from "@/components/ui";
import type { FinAttachmentRow } from "@/lib/dal/finance-attachments";
import { formatDate } from "@/lib/format";

/** W-9 files for a contact. Downloads go through an authorized, audited route. */
export function W9Panel({ contactId, files }: { contactId: string; files: FinAttachmentRow[] }) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useActionForm(uploadW9Action);
  const { run, pending: removing } = useRunner();
  useEffect(() => {
    if (state?.ok) {
      toast.success("W-9 uploaded");
      formRef.current?.reset();
    }
  }, [state, toast]);

  return (
    <div className="space-y-3 text-sm">
      {files.length === 0 ? (
        <p className="text-stone-500">No W-9 uploaded yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="w9-list">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
              <FileText className="h-6 w-6 shrink-0 text-stone-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <a href={`/finance/contacts/w9/${f.id}`} className="block truncate font-semibold hover:underline" download>
                  {f.fileName}
                </a>
                <p className="text-xs text-stone-500">
                  {fileSize(f.sizeBytes)} · uploaded {formatDate(f.createdAt)}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${f.fileName}`}
                disabled={removing}
                onClick={() => run(() => removeW9Action(contactId, f.id), () => "W-9 removed")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-alabaster hover:text-rose-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form ref={formRef} onSubmit={onSubmit} className="space-y-2">
        <input type="hidden" name="contactId" value={contactId} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="file"
            name="file"
            required
            accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
            aria-label="Upload a W-9"
            className="min-w-0 flex-1 rounded-xl border border-dashed border-line bg-alabaster/50 px-3.5 py-2.5 text-xs file:mr-3 file:rounded-full file:border-0 file:bg-charcoal file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Uploading..." : "Upload W-9"}
          </Button>
        </div>
        <p className="text-xs text-stone-400">A W-9 shows a tax ID, so it is only visible to finance editors and admins. PDF or photo, 10 MB or smaller.</p>
        <FormError state={state} />
      </form>
    </div>
  );
}
