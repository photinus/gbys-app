"use server";

import { revalidatePath } from "next/cache";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import {
  addGiftAttachment,
  recordGift,
  releaseFunds,
  removeGiftAttachment,
  searchDonors,
  updateGift,
  voidGift,
} from "@/lib/dal/finance-donations";
import {
  markAnnualStatements,
  markGiftReceipt,
  sendAllAnnualStatements,
  sendAnnualStatement,
  sendGiftReceipt,
  sendUnacknowledgedReceipts,
  type BulkSendResult,
} from "@/lib/dal/finance-receipts";
import { parseDollarsToCents } from "@/lib/validation/finance-donations";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/finance/donations", "layout");
  revalidatePath("/finance/reports/donors");
  revalidatePath("/finance", "page");
}

/** Dollars field -> cents (NaN when invalid, so validation says "Enter an amount"). */
const dollars = (fd: FormData, key: string) => parseDollarsToCents(str(fd, key)) ?? Number.NaN;

function giftInputFrom(fd: FormData) {
  const revenueChoice = str(fd, "revenueAccountId");
  return {
    donorMode: str(fd, "donorMode") as "existing",
    donorContactId: str(fd, "donorContactId"),
    newDonor:
      str(fd, "donorMode") === "new"
        ? {
            displayName: str(fd, "nd_displayName"),
            kind: (str(fd, "nd_kind") || "individual") as "individual",
            email: str(fd, "nd_email"),
            addressLine1: str(fd, "nd_addressLine1"),
            addressLine2: str(fd, "nd_addressLine2"),
            city: str(fd, "nd_city"),
            state: str(fd, "nd_state"),
            postalCode: str(fd, "nd_postalCode"),
          }
        : undefined,
    giftDate: str(fd, "giftDate"),
    amountCents: dollars(fd, "amount"),
    kind: str(fd, "kind") as "cash",
    reference: str(fd, "reference"),
    fundId: str(fd, "fundId"),
    programId: str(fd, "programId"),
    revenueAccountId: revenueChoice === "__other__" ? str(fd, "revenueAccountOther") : revenueChoice,
    depositAccountId: str(fd, "depositAccountId"),
    inKindDebitAccountId: str(fd, "inKindDebitAccountId"),
    inKindDescription: str(fd, "inKindDescription"),
    goodsServicesCents: dollars(fd, "goodsServices"),
    goodsServicesDescription: str(fd, "goodsServicesDescription"),
    campaign: str(fd, "campaign"),
    isAnonymous: fd.get("isAnonymous") === "on",
    note: str(fd, "note"),
    bankTxnId: str(fd, "bankTxnId"),
  };
}

const filesOf = (fd: FormData): File[] => fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

export async function recordGiftAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async (ctx) => {
    const r = await recordGift(ctx, giftInputFrom(fd), filesOf(fd));
    return { id: r.id };
  });
  if (res.ok) refresh();
  return res;
}

export async function updateGiftAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async (ctx) => {
    const r = await updateGift(ctx, str(fd, "giftId"), giftInputFrom(fd));
    return { id: r.id };
  });
  if (res.ok) refresh();
  return res;
}

export async function voidGiftAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ hadReceipt: boolean }>> {
  const res = await runAction((ctx) => voidGift(ctx, { giftId: str(fd, "giftId"), reason: str(fd, "reason") }));
  if (res.ok) refresh();
  return res;
}

export async function addAttachmentAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async (ctx) => {
    const file = fd.get("file");
    if (!(file instanceof File)) throw new DalError("INVALID", "Choose a file to upload.");
    return addGiftAttachment(ctx, str(fd, "giftId"), file);
  });
  if (res.ok) refresh();
  return res;
}

export async function removeAttachmentAction(giftId: string, attachmentId: string): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await removeGiftAttachment(ctx, giftId, attachmentId);
  });
  if (res.ok) refresh();
  return res;
}

export async function sendReceiptAction(giftId: string, resend: boolean): Promise<ActionResult<{ sentTo: string }>> {
  const res = await runAction(async (ctx) => {
    const r = await sendGiftReceipt(ctx, giftId, { resend });
    return { sentTo: r.sentTo };
  });
  if (res.ok) refresh();
  return res;
}

export async function markReceiptAction(giftId: string, method: "print" | "mail"): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await markGiftReceipt(ctx, giftId, method);
  });
  if (res.ok) refresh();
  return res;
}

export async function sendBulkReceiptsAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<BulkSendResult>> {
  const res = await runAction((ctx) => sendUnacknowledgedReceipts(ctx, { from: str(fd, "from"), to: str(fd, "to") }));
  if (res.ok) refresh();
  return res;
}

export async function sendAnnualAction(contactId: string, year: number, resend: boolean): Promise<ActionResult<{ sentTo: string }>> {
  const res = await runAction(async (ctx) => {
    const r = await sendAnnualStatement(ctx, contactId, year, { resend });
    return { sentTo: r.sentTo };
  });
  if (res.ok) refresh();
  return res;
}

export async function sendAllAnnualAction(year: number): Promise<ActionResult<BulkSendResult>> {
  const res = await runAction((ctx) => sendAllAnnualStatements(ctx, year));
  if (res.ok) refresh();
  return res;
}

export async function markAnnualAction(year: number, contactIds: string[], method: "print" | "mail"): Promise<ActionResult<{ marked: number }>> {
  const res = await runAction((ctx) => markAnnualStatements(ctx, { year, contactIds, method }));
  if (res.ok) refresh();
  return res;
}

export async function releaseFundAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ entryNumber: number }>> {
  const res = await runAction(async (ctx) => {
    const r = await releaseFunds(ctx, {
      fundId: str(fd, "fundId"),
      amountCents: dollars(fd, "amount"),
      date: str(fd, "date"),
      reason: str(fd, "reason"),
    });
    return { entryNumber: r.entryNumber };
  });
  if (res.ok) {
    refresh();
    revalidatePath("/finance/reports", "layout");
  }
  return res;
}

export async function searchDonorsAction(q: string): Promise<ActionResult<{ id: string; name: string; email: string | null }[]>> {
  return runAction((ctx) => searchDonors(ctx, q));
}
