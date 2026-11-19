"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  closeBooks,
  grantFinanceAccess,
  reopenBooks,
  revokeFinanceAccess,
  searchFinanceUsers,
  updateFinanceSettings,
} from "@/lib/dal/finance-settings";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/finance", "layout");
}

export async function updateSettingsAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ changed: string[] }>> {
  const res = await runAction((ctx) =>
    updateFinanceSettings(ctx, {
      fiscalYearStartMonth: Number(str(fd, "fiscalYearStartMonth")),
      stripePayoutAccountId: str(fd, "stripePayoutAccountId"),
      autoPostStartDate: str(fd, "autoPostStartDate"),
      dualApprovalThresholdDollars: str(fd, "dualApprovalThresholdDollars"),
      receiptSignerName: str(fd, "receiptSignerName"),
      receiptSignerTitle: str(fd, "receiptSignerTitle"),
      receiptMessage: str(fd, "receiptMessage"),
      invoicePaymentInstructions: str(fd, "invoicePaymentInstructions"),
    })
  );
  if (res.ok) refresh();
  return res;
}

export async function closeBooksAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await closeBooks(ctx, { lockDate: str(fd, "lockDate"), note: str(fd, "note") });
  });
  if (res.ok) refresh();
  return res;
}

export async function reopenBooksAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await reopenBooks(ctx, { lockDate: str(fd, "lockDate"), reason: str(fd, "reason") });
  });
  if (res.ok) refresh();
  return res;
}

export async function grantAccessAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await grantFinanceAccess(ctx, {
      userId: str(fd, "userId"),
      role: str(fd, "role") as "viewer",
      programId: str(fd, "programId"),
    });
  });
  if (res.ok) refresh();
  return res;
}

export async function revokeAccessAction(grantId: string): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await revokeFinanceAccess(ctx, { grantId });
  });
  if (res.ok) refresh();
  return res;
}

export async function searchUsersAction(q: string): Promise<ActionResult<{ id: string; name: string; email: string }[]>> {
  return runAction((ctx) => searchFinanceUsers(ctx, q));
}
