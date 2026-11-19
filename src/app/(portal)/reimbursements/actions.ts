"use server";

import { revalidatePath } from "next/cache";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import { addBillAttachments, removeBillAttachment, submitReimbursement, withdrawReimbursement } from "@/lib/dal/finance-bills";
import type { ReimbursementInput } from "@/lib/validation/finance-bills";

// Claimants act on their own claims only; the DAL enforces that from the session user.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const files = (fd: FormData) => fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

function refresh() {
  revalidatePath("/reimbursements", "layout");
  revalidatePath("/finance/payables", "layout");
}

export async function submitReimbursementAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async (ctx) => {
    let lines: ReimbursementInput["lines"];
    try {
      lines = JSON.parse(str(fd, "lines") || "[]");
    } catch {
      throw new DalError("INVALID", "We couldn't read your items. Please reload the page and try again.");
    }
    return submitReimbursement(
      ctx,
      { claimDate: str(fd, "claimDate"), memo: str(fd, "memo"), programId: str(fd, "programId"), lines },
      files(fd)
    );
  });
  if (res.ok) refresh();
  return res;
}

export async function withdrawClaimAction(id: string): Promise<ActionResult> {
  const res = await runAction((ctx) => withdrawReimbursement(ctx, id));
  if (res.ok) refresh();
  return res;
}

export async function addReceiptsAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async (ctx) => ({ count: await addBillAttachments(ctx, str(fd, "billId"), files(fd)) }));
  if (res.ok) refresh();
  return res;
}

export async function removeReceiptAction(billId: string, attachmentId: string): Promise<ActionResult> {
  const res = await runAction((ctx) => removeBillAttachment(ctx, billId, attachmentId));
  if (res.ok) refresh();
  return res;
}
