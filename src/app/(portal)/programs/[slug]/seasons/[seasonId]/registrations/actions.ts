"use server";

import { revalidatePath } from "next/cache";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import { cancelRegistration, recordOfflinePayment, voidOfflinePayment } from "@/lib/dal/rosters";
import { dollarsToCents, type OfflineMethod } from "@/lib/validation/rosters";

// Authorization (canManageProgram / board) is enforced inside the DAL.

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function revalidateRoster(path: string) {
  // path is the registrations page the form was rendered on
  if (/^\/programs\/[a-z0-9-]+\/seasons\/[0-9a-f-]{36}\/registrations$/i.test(path)) revalidatePath(path);
}

export async function recordPaymentAction(
  _prev: ActionResult | null,
  fd: FormData
): Promise<ActionResult> {
  const method = str(fd, "method") as OfflineMethod;
  const rawAmount = str(fd, "amount");
  const cents = method === "scholarship" ? 0 : dollarsToCents(rawAmount);
  const result = await runAction(async (ctx) => {
    if (cents === null) throw new DalError("INVALID", "Enter a valid amount, e.g. 75.00.");
    await recordOfflinePayment(ctx, str(fd, "registrationId"), {
      method,
      amountCents: cents,
      reference: str(fd, "reference"),
    });
  });
  if (result.ok) revalidateRoster(str(fd, "path"));
  return result;
}

export async function voidPaymentAction(
  _prev: ActionResult | null,
  fd: FormData
): Promise<ActionResult> {
  const result = await runAction((ctx) =>
    voidOfflinePayment(ctx, str(fd, "registrationId"), str(fd, "reason"))
  );
  if (result.ok) revalidateRoster(str(fd, "path"));
  return result;
}

export async function cancelRegistrationAction(
  _prev: ActionResult<{ warning: string | null }> | null,
  fd: FormData
): Promise<ActionResult<{ warning: string | null }>> {
  const result = await runAction((ctx) =>
    cancelRegistration(ctx, str(fd, "registrationId"), str(fd, "reason"))
  );
  if (result.ok) revalidateRoster(str(fd, "path"));
  return result;
}
