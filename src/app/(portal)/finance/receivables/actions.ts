"use server";

import { revalidatePath } from "next/cache";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import { createContact } from "@/lib/dal/finance-contacts";
import {
  addInvoiceAttachment,
  createInvoiceDraft,
  issueInvoice,
  removeInvoiceAttachment,
  sendInvoice,
  updateInvoiceDraft,
  voidInvoice,
} from "@/lib/dal/finance-invoices";
import { recordPaymentIn, voidPaymentIn } from "@/lib/dal/finance-payments-in";
import type { InvoiceInput } from "@/lib/validation/finance-invoices";

// Authorization (finance editor) is enforced inside the DAL; inputs are validated again there.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function parseJson<T>(raw: string, what: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new DalError("INVALID", `We couldn't read the ${what}. Please reload the page and try again.`);
  }
}

function refresh() {
  revalidatePath("/finance", "layout");
}

function invoiceFromForm(fd: FormData): InvoiceInput {
  return {
    contactId: str(fd, "contactId"),
    issueDate: str(fd, "issueDate"),
    dueDate: str(fd, "dueDate"),
    memo: str(fd, "memo"),
    lines: parseJson<InvoiceInput["lines"]>(str(fd, "lines") || "[]", "lines"),
  };
}

export interface SavedInvoice {
  id: string;
  number: number;
  /** "Save and issue" was chosen and succeeded. */
  issued: boolean;
  /** "Save and issue" was chosen but issuing failed (the draft was still saved). */
  issueError?: string;
}

export async function createInvoiceAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<SavedInvoice>> {
  const res = await runAction(async (ctx) => {
    const draft = await createInvoiceDraft(ctx, invoiceFromForm(fd));
    return finishSave(ctx, draft, str(fd, "intent") === "issue");
  });
  if (res.ok) refresh();
  return res;
}

export async function updateInvoiceAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<SavedInvoice>> {
  const res = await runAction(async (ctx) => {
    const id = str(fd, "id");
    await updateInvoiceDraft(ctx, id, invoiceFromForm(fd));
    return finishSave(ctx, { id, number: Number(str(fd, "number")) || 0 }, str(fd, "intent") === "issue");
  });
  if (res.ok) refresh();
  return res;
}

async function finishSave(
  ctx: Parameters<Parameters<typeof runAction>[0]>[0],
  draft: { id: string; number: number },
  issue: boolean
): Promise<SavedInvoice> {
  if (!issue) return { ...draft, issued: false };
  try {
    await issueInvoice(ctx, draft.id);
    return { ...draft, issued: true };
  } catch (e) {
    if (e instanceof DalError) return { ...draft, issued: false, issueError: e.message };
    throw e;
  }
}

export async function issueInvoiceAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ entryNumber: number }>> {
  const res = await runAction((ctx) => issueInvoice(ctx, str(fd, "id")));
  if (res.ok) refresh();
  return res.ok ? { ok: true, data: { entryNumber: res.data.entryNumber } } : res;
}

export async function sendInvoiceAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ sentTo: string }>> {
  const res = await runAction((ctx) => sendInvoice(ctx, { id: str(fd, "id"), toEmail: str(fd, "toEmail") }));
  if (res.ok) refresh();
  return res;
}

export async function voidInvoiceAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<null>> {
  const res = await runAction(async (ctx) => {
    await voidInvoice(ctx, { id: str(fd, "id"), reason: str(fd, "reason") });
    return null;
  });
  if (res.ok) refresh();
  return res;
}

export async function recordPaymentAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ paymentId: string; entryNumber: number }>> {
  const res = await runAction(async (ctx) => {
    const r = await recordPaymentIn(ctx, {
      contactId: str(fd, "contactId"),
      paymentDate: str(fd, "paymentDate"),
      method: str(fd, "method") as never,
      reference: str(fd, "reference"),
      accountId: str(fd, "accountId"),
      memo: str(fd, "memo"),
      bankTxnId: str(fd, "bankTxnId"),
      applications: parseJson<{ invoiceId: string; amountCents: number }[]>(str(fd, "applications") || "[]", "payment amounts"),
    });
    return { paymentId: r.paymentId, entryNumber: r.entryNumber };
  });
  if (res.ok) refresh();
  return res;
}

export async function voidPaymentAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<null>> {
  const res = await runAction(async (ctx) => {
    await voidPaymentIn(ctx, { paymentId: str(fd, "paymentId"), reason: str(fd, "reason") });
    return null;
  });
  if (res.ok) refresh();
  return res;
}

/** Inline "new customer" from the invoice form. */
export async function createCustomerAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ id: string; name: string; email: string | null }>> {
  return runAction(async (ctx) => {
    const name = str(fd, "displayName").trim();
    const email = str(fd, "email").trim().toLowerCase();
    const { id } = await createContact(ctx, {
      displayName: name,
      kind: str(fd, "kind") === "individual" ? "individual" : "organization",
      email,
      isCustomer: true,
    });
    return { id, name, email: email || null };
  });
}

export async function addInvoiceAttachmentAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<null>> {
  const res = await runAction(async (ctx) => {
    const file = fd.get("file");
    if (!(file instanceof File)) throw new DalError("INVALID", "Choose a file to upload.");
    await addInvoiceAttachment(ctx, str(fd, "invoiceId"), file);
    return null;
  });
  if (res.ok) refresh();
  return res;
}

export async function removeInvoiceAttachmentAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<null>> {
  const res = await runAction(async (ctx) => {
    await removeInvoiceAttachment(ctx, str(fd, "invoiceId"), str(fd, "attachmentId"));
    return null;
  });
  if (res.ok) refresh();
  return res;
}
