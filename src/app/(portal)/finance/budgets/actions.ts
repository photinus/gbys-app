"use server";

import { revalidatePath } from "next/cache";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import { adoptBudget, createBudget, deleteDraftBudget, saveBudget, unadoptBudget } from "@/lib/dal/finance-budgets";
import type { BudgetLineInput } from "@/lib/validation/finance-budgets";

// Authorization (editor to edit, admin to adopt) is enforced inside the DAL; inputs are validated again there.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/finance/budgets", "layout");
  revalidatePath("/finance/reports/budget");
}

export async function createBudgetAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ id: string; lineCount: number }>> {
  const res = await runAction((ctx) =>
    createBudget(ctx, {
      name: str(fd, "name"),
      fiscalYearDate: str(fd, "fiscalYearDate"),
      source: str(fd, "source") as never,
      copyFromBudgetId: str(fd, "copyFromBudgetId"),
      notes: str(fd, "notes"),
    })
  );
  if (res.ok) refresh();
  return res;
}

export async function saveBudgetAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ lineCount: number }>> {
  const res = await runAction((ctx) => {
    let lines: BudgetLineInput[];
    try {
      lines = JSON.parse(str(fd, "lines") || "[]") as BudgetLineInput[];
    } catch {
      throw new DalError("INVALID", "We couldn't read the budget amounts. Please reload the page and try again.");
    }
    return saveBudget(ctx, { id: str(fd, "id"), name: str(fd, "name"), notes: str(fd, "notes"), lines });
  });
  if (res.ok) refresh();
  return res;
}

export async function adoptBudgetAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<null>> {
  const res = await runAction(async (ctx) => {
    await adoptBudget(ctx, str(fd, "id"));
    return null;
  });
  if (res.ok) refresh();
  return res;
}

export async function unadoptBudgetAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<null>> {
  const res = await runAction(async (ctx) => {
    await unadoptBudget(ctx, { id: str(fd, "id"), reason: str(fd, "reason") });
    return null;
  });
  if (res.ok) refresh();
  return res;
}

export async function deleteBudgetAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<null>> {
  const res = await runAction(async (ctx) => {
    await deleteDraftBudget(ctx, str(fd, "id"));
    return null;
  });
  if (res.ok) refresh();
  return res;
}
