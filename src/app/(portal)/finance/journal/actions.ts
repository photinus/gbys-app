"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import {
  postManualEntry,
  postOpeningBalances,
  replaceManualEntry,
  voidJournalEntry,
} from "@/lib/dal/finance-journal";

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

type EntryLines = Parameters<typeof postManualEntry>[1]["lines"];

export async function postEntryAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ entryId: string; entryNumber: number }>> {
  const res = await runAction((ctx) =>
    postManualEntry(ctx, {
      entryDate: str(fd, "entryDate"),
      memo: str(fd, "memo"),
      lines: parseJson<EntryLines>(str(fd, "lines") || "[]", "lines"),
    })
  );
  if (res.ok) refresh();
  return res;
}

export async function replaceEntryAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ entryId: string; entryNumber: number }>> {
  const res = await runAction((ctx) =>
    replaceManualEntry(ctx, {
      entryId: str(fd, "entryId"),
      reason: str(fd, "reason"),
      entryDate: str(fd, "entryDate"),
      memo: str(fd, "memo"),
      lines: parseJson<EntryLines>(str(fd, "lines") || "[]", "lines"),
    })
  );
  if (res.ok) {
    refresh();
    // The edit page for the old (now voided) entry would 404 on re-render, so leave it server-side.
    redirect(`/finance/journal/${res.data.entryId}`);
  }
  return res;
}

export async function voidEntryAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ resetBankTransactions: number }>> {
  const res = await runAction((ctx) => voidJournalEntry(ctx, { entryId: str(fd, "entryId"), reason: str(fd, "reason") }));
  if (res.ok) refresh();
  return res;
}

export async function openingBalancesAction(
  _prev: ActionResult<unknown> | null,
  fd: FormData
): Promise<ActionResult<{ entryId: string; entryNumber: number }>> {
  const res = await runAction((ctx) =>
    postOpeningBalances(ctx, {
      asOfDate: str(fd, "asOfDate"),
      memo: str(fd, "memo"),
      rows: parseJson<Parameters<typeof postOpeningBalances>[1]["rows"]>(str(fd, "rows") || "[]", "balances"),
    })
  );
  if (res.ok) refresh();
  return res;
}
