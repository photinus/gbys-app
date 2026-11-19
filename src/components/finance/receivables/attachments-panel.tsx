"use client";

import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { addInvoiceAttachmentAction, removeInvoiceAttachmentAction } from "@/app/(portal)/finance/receivables/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export interface AttachmentItem {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

function size(n: number): string {
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function AttachmentsPanel({ invoiceId, items, canEdit }: { invoiceId: string; items: AttachmentItem[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const add = useActionForm(addInvoiceAttachmentAction);
  const remove = useActionForm(removeInvoiceAttachmentAction);
  useEffect(() => {
    if (add.state?.ok) {
      toast.success("File attached");
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add.state]);
  useEffect(() => {
    if (remove.state?.ok) {
      toast.success("File removed");
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remove.state]);

  return (
    <div className="space-y-3 text-sm">
      {items.length === 0 ? (
        <p className="text-stone-500">No files attached.</p>
      ) : (
        <ul className="divide-y divide-line-soft rounded-2xl border border-line">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3.5 py-2.5" data-testid="attachment">
              <FileText className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <a
                  href={`/finance/receivables/${invoiceId}/attachments/${a.id}`}
                  className="block truncate font-semibold text-indigo-700 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.fileName}
                </a>
                <span className="text-xs text-stone-400">
                  {size(a.sizeBytes)} · {formatDateTime(a.createdAt)}
                </span>
              </div>
              {canEdit ? (
                <form onSubmit={remove.onSubmit}>
                  <input type="hidden" name="invoiceId" value={invoiceId} />
                  <input type="hidden" name="attachmentId" value={a.id} />
                  <button
                    type="submit"
                    aria-label={`Remove ${a.fileName}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-alabaster hover:text-rose-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={add.onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <input
            ref={fileRef}
            type="file"
            name="file"
            required
            accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
            className="min-w-0 flex-1 text-xs file:mr-3 file:rounded-full file:border-0 file:bg-alabaster file:px-3.5 file:py-2 file:text-xs file:font-semibold"
            data-testid="attachment-file"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={add.pending} data-testid="attachment-upload">
            <Paperclip className="h-4 w-4" /> {add.pending ? "Uploading..." : "Attach file"}
          </Button>
        </form>
      ) : null}
      <p className="text-xs text-stone-400">PDF or photo (PNG, JPEG, WebP, HEIC), up to 10 MB.</p>
      <FormError state={add.state} />
      <FormError state={remove.state} />
    </div>
  );
}
