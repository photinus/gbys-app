"use client";

import { CheckCircle2, Lock, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adoptBudgetAction, deleteBudgetAction, unadoptBudgetAction } from "@/app/(portal)/finance/budgets/actions";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import { Button, Field, Modal, Textarea, useToast } from "@/components/ui";

/** Adopt (admin), Un-adopt with a reason (admin) and Delete draft (editors) for the budget page. */
export function BudgetActions({
  budgetId,
  name,
  status,
  canAdopt,
  canEdit,
}: {
  budgetId: string;
  name: string;
  status: "draft" | "adopted";
  canAdopt: boolean;
  /** Editors may delete drafts. */
  canEdit: boolean;
}) {
  const [open, setOpen] = useState<"adopt" | "unadopt" | "delete" | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && canAdopt ? (
          <Button size="sm" onClick={() => setOpen("adopt")} data-testid="adopt-open">
            <CheckCircle2 className="h-4 w-4" /> Adopt budget
          </Button>
        ) : null}
        {status === "adopted" && canAdopt ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen("unadopt")} data-testid="unadopt-open">
            <Lock className="h-4 w-4" /> Un-adopt to edit
          </Button>
        ) : null}
        {status === "draft" && canEdit ? (
          <Button size="sm" variant="danger" onClick={() => setOpen("delete")} data-testid="delete-open">
            <Trash2 className="h-4 w-4" /> Delete draft
          </Button>
        ) : null}
      </div>
      <Simple open={open === "adopt"} onClose={close} budgetId={budgetId} action={adoptBudgetAction} formId="adopt-form" confirmId="adopt-confirm"
        title={`Adopt “${name}”?`}
        description="Adopting makes this the official budget for its fiscal year and locks it so nobody changes it by accident."
        confirm="Adopt budget" success="Budget adopted" variant="primary">
        <p className="text-stone-600">Only one budget can be adopted per fiscal year. You can un-adopt it later (with a reason) if the board revises the plan.</p>
      </Simple>
      <Simple open={open === "unadopt"} onClose={close} budgetId={budgetId} action={unadoptBudgetAction} formId="unadopt-form" confirmId="unadopt-confirm"
        title={`Un-adopt “${name}”?`}
        description="The budget goes back to a draft so it can be edited. The reason is kept in the history."
        confirm="Un-adopt" success="Budget is a draft again" variant="danger" reason>
        <p className="text-stone-600">Reports will keep using it, but it is no longer the locked, official version until you adopt it again.</p>
      </Simple>
      <Simple open={open === "delete"} onClose={close} budgetId={budgetId} action={deleteBudgetAction} formId="delete-form" confirmId="delete-confirm"
        title={`Delete the draft “${name}”?`}
        description="This removes the draft and all its amounts. It can't be undone."
        confirm="Delete draft" success="Draft deleted" variant="danger" redirectTo="/finance/budgets">
        <p className="text-stone-600">Adopted budgets can't be deleted.</p>
      </Simple>
    </>
  );
}

function Simple({
  open,
  onClose,
  budgetId,
  action,
  formId,
  confirmId,
  title,
  description,
  confirm,
  success,
  variant,
  reason,
  redirectTo,
  children,
}: {
  open: boolean;
  onClose: () => void;
  budgetId: string;
  action: Parameters<typeof useActionForm<null>>[0];
  formId: string;
  confirmId: string;
  title: string;
  description: string;
  confirm: string;
  success: string;
  variant: "primary" | "danger";
  reason?: boolean;
  redirectTo?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(action);
  useEffect(() => {
    if (state?.ok) {
      toast.success(success);
      onClose();
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={variant} type="submit" form={formId} disabled={pending} data-testid={confirmId}>
            {pending ? "Working..." : confirm}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="space-y-4 text-sm">
        <input type="hidden" name="id" value={budgetId} />
        {children}
        {reason ? (
          <Field label="Reason" hint="e.g. “Board approved a higher sponsorship goal”.">
            <Textarea name="reason" required minLength={3} maxLength={500} rows={3} data-testid="unadopt-reason" />
          </Field>
        ) : null}
        <FormError state={state} />
      </form>
    </Modal>
  );
}
