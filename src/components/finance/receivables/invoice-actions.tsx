"use client";

import { Mail, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { issueInvoiceAction, sendInvoiceAction, voidInvoiceAction } from "@/app/(portal)/finance/receivables/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Input, Modal, Textarea, useToast } from "@/components/ui";

/** Issue (drafts), Send / Re-send (issued) and Void buttons for the invoice detail page. */
export function InvoiceActions({
  invoiceId,
  number,
  status,
  customerEmail,
  alreadySent,
  hasPayments,
}: {
  invoiceId: string;
  number: number;
  status: string;
  customerEmail: string | null;
  alreadySent: boolean;
  /** Live payments are applied: voiding is blocked until they are voided. */
  hasPayments: boolean;
}) {
  const [open, setOpen] = useState<"issue" | "send" | "void" | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "draft" ? (
          <Button size="sm" onClick={() => setOpen("issue")} data-testid="issue-open">
            <Send className="h-4 w-4" /> Issue invoice
          </Button>
        ) : null}
        {status !== "draft" && status !== "void" ? (
          <Button size="sm" variant={alreadySent ? "secondary" : "primary"} onClick={() => setOpen("send")} data-testid="send-open">
            <Mail className="h-4 w-4" /> {alreadySent ? "Send again" : "Email invoice"}
          </Button>
        ) : null}
        {status !== "void" ? (
          <Button size="sm" variant="danger" onClick={() => setOpen("void")} data-testid="void-invoice-open">
            Void
          </Button>
        ) : null}
      </div>
      <IssueModal open={open === "issue"} onClose={close} invoiceId={invoiceId} number={number} />
      <SendModal open={open === "send"} onClose={close} invoiceId={invoiceId} number={number} customerEmail={customerEmail} />
      <VoidModal open={open === "void"} onClose={close} invoiceId={invoiceId} number={number} draft={status === "draft"} hasPayments={hasPayments} />
    </>
  );
}

function IssueModal({ open, onClose, invoiceId, number }: { open: boolean; onClose: () => void; invoiceId: string; number: number }) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(issueInvoiceAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success(`Invoice #${number} issued`);
      onClose();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Issue invoice #${number}?`}
      description="Issuing records the amount as money owed to you and makes the invoice final."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Not yet
          </Button>
          <Button type="submit" form="issue-invoice-form" disabled={pending} data-testid="issue-confirm">
            {pending ? "Issuing..." : "Issue invoice"}
          </Button>
        </>
      }
    >
      <form id="issue-invoice-form" onSubmit={onSubmit} className="space-y-3 text-sm">
        <input type="hidden" name="id" value={invoiceId} />
        <p className="text-stone-600">After it is issued you can no longer change the lines or amounts. If something is wrong you can void it and create a new one.</p>
        <FormError state={state} />
      </form>
    </Modal>
  );
}

function SendModal({
  open,
  onClose,
  invoiceId,
  number,
  customerEmail,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  number: number;
  customerEmail: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(sendInvoiceAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success(`Invoice #${number} emailed to ${state.data.sentTo}`);
      onClose();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Email invoice #${number}`}
      description="The customer gets the invoice details and how to pay."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="send-invoice-form" disabled={pending} data-testid="send-confirm">
            {pending ? "Sending..." : "Send email"}
          </Button>
        </>
      }
    >
      <form id="send-invoice-form" onSubmit={onSubmit} className="space-y-4 text-sm">
        <input type="hidden" name="id" value={invoiceId} />
        <Field label="Send to" hint={customerEmail ? "Defaults to the customer's email." : "This customer has no email on file. Enter one for this send."}>
          <Input name="toEmail" type="email" defaultValue={customerEmail ?? ""} required maxLength={254} data-testid="send-to" />
        </Field>
        <FormError state={state} />
      </form>
    </Modal>
  );
}

function VoidModal({
  open,
  onClose,
  invoiceId,
  number,
  draft,
  hasPayments,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  number: number;
  draft: boolean;
  hasPayments: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(voidInvoiceAction);
  useEffect(() => {
    if (state?.ok) {
      toast.success(`Invoice #${number} voided`);
      onClose();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Void invoice #${number}?`}
      description={draft ? "The draft is kept on record but can't be used." : "The invoice stays on record, but it is removed from what customers owe you and from your revenue."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep invoice
          </Button>
          <Button variant="danger" type="submit" form="void-invoice-form" disabled={pending} data-testid="void-invoice-confirm">
            {pending ? "Voiding..." : "Void invoice"}
          </Button>
        </>
      }
    >
      <form id="void-invoice-form" onSubmit={onSubmit} className="space-y-4 text-sm">
        <input type="hidden" name="id" value={invoiceId} />
        {hasPayments ? (
          <p className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs text-amber-950">
            Payments have been recorded for this invoice. Void those payments first (in the Payments section), then void the invoice.
          </p>
        ) : null}
        <Field label="Reason" hint="Shown in the history, e.g. “Billed the wrong customer”.">
          <Textarea name="reason" required minLength={3} maxLength={500} rows={3} data-testid="void-invoice-reason" />
        </Field>
        <FormError state={state} />
      </form>
    </Modal>
  );
}
