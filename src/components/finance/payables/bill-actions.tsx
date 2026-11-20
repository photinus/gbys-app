"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { decideBillAction, submitBillAction, voidBillAction } from "@/app/(portal)/finance/payables/actions";
import { useRunner } from "@/components/finance/banking/use-runner";
import { Button, Field, Modal, Textarea, buttonStyles } from "@/components/ui";
import type { BillViewer } from "@/lib/dal/finance-bills";

type Dialog = null | "approve" | "reject" | "void";

/** Buttons on a bill page, driven by what the viewer is allowed to do right now. */
export function BillActions({
  billId,
  kind,
  viewer,
  approvalsRequired,
}: {
  billId: string;
  kind: "bill" | "reimbursement";
  viewer: BillViewer;
  approvalsRequired: number;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState("");
  const { run, pending, error, setError } = useRunner({ inline: true });
  const toastRunner = useRunner();

  const close = () => {
    setDialog(null);
    setNote("");
    setError(null);
  };

  const confirm = () => {
    if (dialog === "approve") {
      run(
        () => decideBillAction(billId, "approve", note),
        (r) => {
          close();
          router.refresh();
          return r.posted
            ? `Approved and added to the books${r.entryNumber ? ` (entry #${r.entryNumber})` : ""}`
            : `Approved. ${r.required - r.approvals} more approval needed.`;
        }
      );
    } else if (dialog === "reject") {
      run(
        () => decideBillAction(billId, "reject", note),
        () => {
          close();
          router.refresh();
          return "Sent back";
        }
      );
    } else if (dialog === "void") {
      run(
        () => voidBillAction(billId, note),
        () => {
          close();
          router.refresh();
          return "Voided";
        }
      );
    }
  };

  const any = viewer.canEdit || viewer.canSubmit || viewer.canApprove || viewer.canPay || viewer.canVoid;
  if (!any) return null;
  const noun = kind === "reimbursement" ? "claim" : "bill";

  return (
    <div className="flex flex-wrap gap-2" data-testid="bill-actions">
      {viewer.canApprove ? (
        <>
          <Button onClick={() => setDialog("approve")} data-testid="approve-button">
            Approve
          </Button>
          <Button variant="secondary" onClick={() => setDialog("reject")} data-testid="reject-button">
            Send back
          </Button>
        </>
      ) : null}
      {viewer.canSubmit ? (
        <Button
          onClick={() =>
            toastRunner.run(
              () => submitBillAction(billId),
              (r) => {
                router.refresh();
                return r.approvalsRequired > 1 ? "Submitted. Two approvers are needed because of the amount." : "Submitted for approval";
              }
            )
          }
          disabled={toastRunner.pending}
          data-testid="submit-button"
        >
          Submit for approval
        </Button>
      ) : null}
      {viewer.canEdit ? (
        <Link href={`/finance/payables/${billId}/edit`} className={buttonStyles({ variant: "secondary" })}>
          Edit
        </Link>
      ) : null}
      {viewer.canPay ? (
        <Link href={`/finance/payables/pay?bill=${billId}`} className={buttonStyles({ variant: "primary" })} data-testid="pay-link">
          Pay this
        </Link>
      ) : null}
      {viewer.canVoid ? (
        <Button variant="ghost" onClick={() => setDialog("void")} data-testid="void-button">
          Void
        </Button>
      ) : null}

      <Modal
        open={dialog !== null}
        onClose={close}
        title={dialog === "approve" ? `Approve this ${noun}?` : dialog === "reject" ? `Send this ${noun} back?` : `Void this ${noun}?`}
        description={
          dialog === "approve"
            ? approvalsRequired > 1
              ? "Because of the amount, two different people need to approve. It posts to the books after the second approval."
              : "Approving adds it to the books as money we owe."
            : dialog === "reject"
              ? kind === "reimbursement"
                ? "The member will be told why. They can submit a corrected claim."
                : "The person who entered it will be told why and can fix and resubmit it."
              : "It stays on record, but it is removed from the books. This can't be undone."
        }
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              variant={dialog === "approve" ? "primary" : "danger"}
              onClick={confirm}
              disabled={pending || (dialog !== "approve" && note.trim().length < 3)}
              data-testid="dialog-confirm"
            >
              {pending ? "Working..." : dialog === "approve" ? "Approve" : dialog === "reject" ? "Send back" : "Void"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            label={dialog === "approve" ? "Note (optional)" : dialog === "reject" ? "Why are you sending it back?" : "Why are you voiding it?"}
            hint={dialog === "approve" ? undefined : "Required."}
          >
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} data-testid="dialog-note" />
          </Field>
          {error ? (
            <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
