"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  acceptSuggestion,
  applyRulesToNew,
  bulkCategorize,
  categorizeTxn,
  connectSimplefin,
  disconnectSimplefin,
  excludeTxn,
  matchTxn,
  restoreTxn,
  syncNow,
  transferTxn,
  undoTxn,
  updateBankAccountMapping,
  type BulkResult,
  type SyncNowResult,
} from "@/lib/dal/finance-banking";
import {
  completeReconciliation,
  discardReconciliation,
  setLinesCleared,
  startReconciliation,
} from "@/lib/dal/finance-reconcile";
import { moveRule, saveRule, setRuleActive } from "@/lib/dal/finance-rules";

/** Server actions for the banking pages: zod (inside the DAL) -> runAction -> revalidate -> ActionResult. */

function touch() {
  // Overview counts, journal and reports read the same ledger, so refresh the whole finance area.
  revalidatePath("/finance", "layout");
}

export async function connectAction(input: unknown): Promise<ActionResult<{ accounts: number; warning: string | null }>> {
  return runAction(async (ctx) => {
    const r = await connectSimplefin(ctx, input);
    touch();
    return r;
  });
}

export async function disconnectAction(connectionId: string): Promise<ActionResult<void>> {
  return runAction(async (ctx) => {
    await disconnectSimplefin(ctx, String(connectionId));
    touch();
  });
}

export async function syncNowAction(): Promise<ActionResult<SyncNowResult>> {
  return runAction(async (ctx) => {
    const r = await syncNow(ctx);
    touch();
    return r;
  });
}

export async function updateMappingAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async (ctx) => {
    await updateBankAccountMapping(ctx, input);
    touch();
  });
}

export async function categorizeAction(input: unknown): Promise<ActionResult<{ entryNumber: number }>> {
  return runAction(async (ctx) => {
    const r = await categorizeTxn(ctx, input);
    touch();
    return r;
  });
}

export async function acceptSuggestionAction(txnId: string): Promise<ActionResult<{ entryNumber: number }>> {
  return runAction(async (ctx) => {
    const r = await acceptSuggestion(ctx, String(txnId));
    touch();
    return r;
  });
}

export async function bulkCategorizeAction(input: unknown): Promise<ActionResult<BulkResult>> {
  return runAction(async (ctx) => {
    const r = await bulkCategorize(ctx, input);
    touch();
    return r;
  });
}

export async function transferAction(input: unknown): Promise<ActionResult<{ entryNumber: number }>> {
  return runAction(async (ctx) => {
    const r = await transferTxn(ctx, input);
    touch();
    return r;
  });
}

export async function matchAction(input: unknown): Promise<ActionResult<{ entryNumber: number }>> {
  return runAction(async (ctx) => {
    const r = await matchTxn(ctx, input);
    touch();
    return r;
  });
}

export async function excludeAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async (ctx) => {
    await excludeTxn(ctx, input);
    touch();
  });
}

export async function restoreAction(txnId: string): Promise<ActionResult<void>> {
  return runAction(async (ctx) => {
    await restoreTxn(ctx, String(txnId));
    touch();
  });
}

export async function undoAction(txnId: string): Promise<ActionResult<{ voided: boolean }>> {
  return runAction(async (ctx) => {
    const r = await undoTxn(ctx, String(txnId));
    touch();
    return r;
  });
}

export async function saveRuleAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async (ctx) => {
    const r = await saveRule(ctx, input);
    touch();
    return r;
  });
}

export async function setRuleActiveAction(id: string, isActive: boolean): Promise<ActionResult<void>> {
  return runAction(async (ctx) => {
    await setRuleActive(ctx, String(id), Boolean(isActive));
    touch();
  });
}

export async function moveRuleAction(id: string, direction: "up" | "down"): Promise<ActionResult<void>> {
  return runAction(async (ctx) => {
    await moveRule(ctx, String(id), direction === "up" ? "up" : "down");
    touch();
  });
}

export async function applyRulesAction(): Promise<ActionResult<{ checked: number; matched: number; posted: number; suggested: number }>> {
  return runAction(async (ctx) => {
    const r = await applyRulesToNew(ctx);
    touch();
    return r;
  });
}

export async function startReconciliationAction(input: unknown): Promise<ActionResult<{ id: string; beginningBalanceCents: number }>> {
  return runAction(async (ctx) => {
    const r = await startReconciliation(ctx, input);
    touch();
    return r;
  });
}

/** Toggling a line doesn't revalidate: the workspace keeps its own state while open. */
export async function setClearedAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async (ctx) => {
    await setLinesCleared(ctx, input);
  });
}

export async function completeReconciliationAction(input: unknown): Promise<ActionResult<{ clearedCount: number }>> {
  return runAction(async (ctx) => {
    const r = await completeReconciliation(ctx, input);
    touch();
    return r;
  });
}

export async function discardReconciliationAction(input: unknown): Promise<ActionResult<void>> {
  return runAction(async (ctx) => {
    await discardReconciliation(ctx, input);
    touch();
  });
}
