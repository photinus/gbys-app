"use client";

import { Mail, Printer, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  addAttachmentAction,
  markReceiptAction,
  removeAttachmentAction,
  sendReceiptAction,
  voidGiftAction,
} from "@/app/(portal)/finance/donations/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Modal, Textarea, buttonStyles, useToast } from "@/components/ui";
import { formatDate } from "@/lib/format";

/** Void a gift. Warns when a receipt was already sent. */
export function VoidGiftButton({ giftId, receiptSentAt }: { giftId: string; receiptSentAt: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { state, pending, onSubmit } = useActionForm(voidGiftAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success("Gift voided");
      setOpen(false);
      router.refresh();
    }
  }, [state, toast, router]);
  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)} data-testid="void-open">
        <Trash2 className="h-4 w-4" /> Void gift
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Void this gift?"
        description="Voiding keeps the gift on record but removes it from balances and reports."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep gift
            </Button>
            <Button variant="danger" type="submit" form="void-gift-form" disabled={pending} data-testid="void-confirm">
              {pending ? "Voiding..." : "Void gift"}
            </Button>
          </>
        }
      >
        <form id="void-gift-form" onSubmit={onSubmit} className="space-y-4 text-sm">
          <input type="hidden" name="giftId" value={giftId} />
          {receiptSentAt ? (
            <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950" data-testid="void-receipt-warning">
              A receipt for this gift was sent on {formatDate(receiptSentAt)}. Voiding doesn&apos;t un-send it, so you may want to let the donor know the receipt is no longer valid.
            </p>
          ) : null}
          <Field label="Reason" hint="Shown in the history, e.g. “Check bounced”.">
            <Textarea name="reason" required minLength={3} maxLength={500} rows={3} data-testid="void-reason" />
          </Field>
          <FormError state={state} />
        </form>
      </Modal>
    </>
  );
}

/** Per-gift receipt buttons: email, print, mark printed / mailed. */
export function GiftReceiptActions({
  giftId,
  hasEmail,
  donorName,
  needsReceipt,
  alreadySent,
}: {
  giftId: string;
  hasEmail: boolean;
  donorName: string;
  needsReceipt: boolean;
  alreadySent: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const resend = alreadySent && !needsReceipt;

  async function email() {
    setBusy("email");
    setErr(null);
    const r = await sendReceiptAction(giftId, resend);
    setBusy(null);
    if (r.ok) {
      toast.success(`Receipt emailed to ${r.data.sentTo}`);
      setConfirm(false);
      router.refresh();
    } else {
      setErr(r.error);
    }
  }
  async function mark(method: "print" | "mail") {
    setBusy(method);
    setErr(null);
    const r = await markReceiptAction(giftId, method);
    setBusy(null);
    if (r.ok) {
      toast.success(method === "print" ? "Marked as printed" : "Marked as mailed");
      router.refresh();
    } else setErr(r.error);
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setConfirm(true)} disabled={!hasEmail || busy !== null} data-testid="send-receipt">
          <Mail className="h-4 w-4" /> {resend ? "Send again by email" : "Email receipt"}
        </Button>
        <Link href={`/finance/donations/${giftId}/receipt`} className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="print-receipt">
          <Printer className="h-4 w-4" /> Print receipt
        </Link>
        <Button size="sm" variant="secondary" onClick={() => mark("mail")} disabled={busy !== null} data-testid="mark-mailed">
          Mark as mailed
        </Button>
        <Button size="sm" variant="ghost" onClick={() => mark("print")} disabled={busy !== null}>
          Mark as printed
        </Button>
      </div>
      {!hasEmail ? <p className="text-xs text-amber-800">{donorName} has no email address. Add one on their contact page, or print the receipt.</p> : null}
      {err ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {err}
        </p>
      ) : null}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={resend ? "Send this receipt again?" : "Email this receipt?"}
        description={`It goes to ${donorName}. The send is saved in the receipt history.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={email} disabled={busy === "email"} data-testid="send-receipt-confirm">
              <Send className="h-4 w-4" /> {busy === "email" ? "Sending..." : "Send"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-stone-600">
          Tip: use <strong>Print receipt</strong> first if you want to read exactly what the donor will see.
        </p>
        {err ? <p className="mt-3 text-xs font-medium text-rose-800">{err}</p> : null}
      </Modal>
    </div>
  );
}

/** Attachments: upload and remove (downloads are plain links to the authorized route). */
export function AttachmentsPanel({
  giftId,
  items,
  canEdit,
}: {
  giftId: string;
  items: { id: string; fileName: string; sizeBytes: number }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const { state, pending, onSubmit } = useActionForm(addAttachmentAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success("File added");
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, toast, router]);
  async function remove(id: string) {
    const r = await removeAttachmentAction(giftId, id);
    if (r.ok) {
      toast.success("File removed");
      router.refresh();
    } else toast({ title: r.error, tone: "error" });
  }
  return (
    <div className="space-y-3 text-sm">
      {items.length === 0 ? <p className="text-xs text-stone-500">No files attached.</p> : null}
      <ul className="divide-y divide-line-soft rounded-2xl border border-line">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <a href={`/finance/donations/${giftId}/attachments/${a.id}`} className="min-w-0 truncate font-semibold text-indigo-900 hover:underline" target="_blank" rel="noreferrer">
              {a.fileName}
            </a>
            <span className="flex shrink-0 items-center gap-3 text-xs text-stone-500">
              {(a.sizeBytes / 1024).toFixed(0)} KB
              {canEdit ? (
                <button type="button" onClick={() => remove(a.id)} className="font-semibold text-rose-800 hover:underline">
                  Remove
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <input type="hidden" name="giftId" value={giftId} />
          <Field label="Add a file" hint="PDF or photo, up to 10 MB." className="flex-1">
            <Input type="file" name="file" required accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" />
          </Field>
          <Button type="submit" size="md" disabled={pending}>
            {pending ? "Uploading..." : "Upload"}
          </Button>
        </form>
      ) : null}
      <FormError state={state} />
    </div>
  );
}
