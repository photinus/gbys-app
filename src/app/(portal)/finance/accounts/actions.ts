"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  createAccount,
  createFund,
  setAccountActive,
  setFundActive,
  updateAccount,
  updateFund,
} from "@/lib/dal/finance-accounts";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";

function refresh() {
  revalidatePath("/finance", "layout");
}

export async function saveAccountAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const id = str(fd, "id");
  const res = await runAction(async (ctx) => {
    const input = {
      code: str(fd, "code"),
      name: str(fd, "name"),
      type: str(fd, "type") as "asset",
      subtype: str(fd, "subtype"),
      description: str(fd, "description"),
      isBank: bool(fd, "isBank"),
      is1099: bool(fd, "is1099"),
    };
    if (id) {
      await updateAccount(ctx, { ...input, id });
      return { id };
    }
    return createAccount(ctx, input);
  });
  if (res.ok) refresh();
  return res;
}

export async function saveFundAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const id = str(fd, "id");
  const res = await runAction(async (ctx) => {
    const input = {
      name: str(fd, "name"),
      code: str(fd, "code"),
      restriction: str(fd, "restriction") as "without_donor_restrictions",
      programId: str(fd, "programId"),
      purpose: str(fd, "purpose"),
    };
    if (id) {
      await updateFund(ctx, { ...input, id });
      return { id };
    }
    return createFund(ctx, input);
  });
  if (res.ok) refresh();
  return res;
}

export async function setAccountActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await setAccountActive(ctx, { id, isActive });
  });
  if (res.ok) refresh();
  return res;
}

export async function setFundActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    await setFundActive(ctx, { id, isActive });
  });
  if (res.ok) refresh();
  return res;
}
