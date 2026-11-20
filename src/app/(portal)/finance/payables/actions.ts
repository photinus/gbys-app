"use server";

import { revalidatePath } from "next/cache";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import {
  addBillAttachments,
  createBill,
  decideBill,
  recategorizeBill,
  removeBillAttachment,
  submitBill,
  updateBill,
  voidBill,
  type DecideResult,
} from "@/lib/dal/finance-bills";
import { recordPayment, voidPayment } from "@/lib/dal/finance-payments-out";
import type { BillInput } from "@/lib/validation/finance-bills";

// Authorization and validation live in the DAL; these wrappers only parse form data.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function files(fd: FormData, key = "files"): File[] {
  return fd.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
}

function parseJson<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new DalError("INVALID", `We couldn't read the ${what}. Please reload the page and try again.`);
  }
}

function refresh() {
  revalidatePath("/finance", "layout");
  revalidatePath("/reimbursements", "layout");
}

function billInput(fd: FormData): BillInput {
  const newVendorRaw = str(fd, "newVendor");
  return {
    contactId: str(fd, "contactId"),
    newVendor: newVendorRaw ? parseJson(newVendorRaw, "vendor") : null,
    vendorInvoiceNumber: str(fd, "vendorInvoiceNumber"),
    programId: str(fd, "programId"),
    billDate: str(fd, "billDate"),
    dueDate: str(fd, "dueDate"),
    memo: str(fd, "memo"),
    lines: parseJson<BillInput["lines"]>(str(fd, "lines") || "[]", "lines"),
  };
}

export interface SaveBillResult {
  id: string;
  /** Set when "save and submit" saved the draft but the submit step was refused. */
  submitError?: string;
  submitted: boolean;
}

export async function createBillAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<SaveBillResult>> {
  const res = await runAction(async (ctx) => {
    const { id } = await createBill(ctx, billInput(fd), files(fd));
    return finishSave(ctx, id, str(fd, "intent") === "submit");
  });
  if (res.ok) refresh();
  return res;
}

export async function updateBillAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<SaveBillResult>> {
  const res = await runAction(async (ctx) => {
    const id = str(fd, "billId");
    await updateBill(ctx, id, billInput(fd), files(fd));
    return finishSave(ctx, id, str(fd, "intent") === "submit");
  });
  if (res.ok) refresh();
  return res;
}

async function finishSave(ctx: Parameters<Parameters<typeof runAction>[0]>[0], id: string, submit: boolean): Promise<SaveBillResult> {
  if (!submit) return { id, submitted: false };
  try {
    await submitBill(ctx, id);
    return { id, submitted: true };
  } catch (e) {
    if (e instanceof DalError) return { id, submitted: false, submitError: e.message };
    throw e;
  }
}

export async function submitBillAction(billId: string): Promise<ActionResult<{ approvalsRequired: number }>> {
  const res = await runAction((ctx) => submitBill(ctx, billId));
  if (res.ok) refresh();
  return res;
}

export async function decideBillAction(billId: string, decision: "approve" | "reject", note: string): Promise<ActionResult<DecideResult>> {
  const res = await runAction((ctx) => decideBill(ctx, billId, { decision, note }));
  if (res.ok) refresh();
  return res;
}

export async function recategorizeBillAction(billId: string, lines: BillInput["lines"]): Promise<ActionResult> {
  const res = await runAction((ctx) => recategorizeBill(ctx, billId, { lines }));
  if (res.ok) refresh();
  return res;
}

export async function voidBillAction(billId: string, reason: string): Promise<ActionResult> {
  const res = await runAction((ctx) => voidBill(ctx, billId, reason));
  if (res.ok) refresh();
  return res;
}

export async function addAttachmentsAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ count: number }>> {
  const res = await runAction(async (ctx) => ({ count: await addBillAttachments(ctx, str(fd, "billId"), files(fd)) }));
  if (res.ok) refresh();
  return res;
}

export async function removeAttachmentAction(billId: string, attachmentId: string): Promise<ActionResult> {
  const res = await runAction((ctx) => removeBillAttachment(ctx, billId, attachmentId));
  if (res.ok) refresh();
  return res;
}

export async function recordPaymentAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string; entryNumber: number }>> {
  const res = await runAction((ctx) =>
    recordPayment(ctx, {
      contactId: str(fd, "contactId"),
      paymentDate: str(fd, "paymentDate"),
      method: str(fd, "method") as "check",
      reference: str(fd, "reference"),
      accountId: str(fd, "accountId"),
      memo: str(fd, "memo"),
      bankTxnId: str(fd, "bankTxnId"),
      applications: parseJson(str(fd, "applications") || "[]", "payment list"),
    })
  );
  if (res.ok) refresh();
  return res;
}

export async function voidPaymentAction(paymentId: string, reason: string): Promise<ActionResult> {
  const res = await runAction((ctx) => voidPayment(ctx, paymentId, reason));
  if (res.ok) refresh();
  return res;
}
