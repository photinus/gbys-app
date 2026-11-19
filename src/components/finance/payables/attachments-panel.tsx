"use client";

import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { addAttachmentsAction, removeAttachmentAction } from "@/app/(portal)/finance/payables/actions";
import { addReceiptsAction, removeReceiptAction } from "@/app/(portal)/reimbursements/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { useRunner } from "@/components/finance/banking/use-runner";
import { Button, useToast } from "@/components/ui";
import type { FinAttachmentRow } from "@/lib/dal/finance-attachments";
import { formatDate } from "@/lib/format";
import { ATTACHMENT_HREF, fileSize, isPreviewable } from "./shared";

/** Files on a bill or reimbursement: view, add, remove. `claimant` uses the member actions. */
export function AttachmentsPanel({
  billId,
  attachments,
  canChange,
  claimant = false,
  label = "Files",
}: {
  billId: string;
  attachments: FinAttachmentRow[];
  canChange: boolean;
  claimant?: boolean;
  label?: string;
}) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useActionForm(claimant ? addReceiptsAction : addAttachmentsAction);
  const { run, pending: removing } = useRunner();

  useEffect(() => {
    if (state?.ok) {
      toast.success("File added");
      formRef.current?.reset();
    }
  }, [state, toast]);

  return (
    <div className="space-y-3">
      {attachments.length === 0 ? (
        <p className="text-sm text-stone-500">No files yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="attachment-list">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
              {isPreviewable(a.contentType) ? (
                <a href={ATTACHMENT_HREF(a.id)} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ATTACHMENT_HREF(a.id)} alt={a.fileName} className="h-14 w-14 rounded-xl border border-line object-cover" />
                </a>
              ) : (
                <FileText className="h-8 w-8 shrink-0 text-stone-400" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <a href={ATTACHMENT_HREF(a.id)} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-charcoal hover:underline">
                  {a.fileName}
                </a>
                <p className="text-xs text-stone-500">
                  {fileSize(a.sizeBytes)} · {formatDate(a.createdAt)}
                </p>
              </div>
              {canChange ? (
                <button
                  type="button"
                  aria-label={`Remove ${a.fileName}`}
                  disabled={removing}
                  onClick={() =>
                    run(() => (claimant ? removeReceiptAction(billId, a.id) : removeAttachmentAction(billId, a.id)), () => "File removed")
                  }
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-alabaster hover:text-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canChange ? (
        <form ref={formRef} onSubmit={onSubmit} className="space-y-2">
          <input type="hidden" name="billId" value={billId} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line bg-alabaster/50 px-3.5 py-2.5 text-sm text-stone-600">
              <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
              <input
                type="file"
                name="files"
                multiple
                required
                accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
                aria-label={`Add ${label.toLowerCase()}`}
                className="min-w-0 flex-1 text-xs file:mr-3 file:rounded-full file:border-0 file:bg-charcoal file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
              />
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Uploading..." : "Add"}
            </Button>
          </div>
          <p className="text-xs text-stone-400">PDF or photo, 10 MB or smaller each.</p>
          <FormError state={state} />
        </form>
      ) : null}
    </div>
  );
}
