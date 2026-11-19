import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { finAccounts, finBankAccounts, finBankRules, finFunds, programs } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import { ruleSchema, type RuleInput } from "@/lib/validation/finance-banking";

/**
 * Bank rules (workstream FB). A rule suggests (or, with autoPost, immediately posts) a
 * category for matching bank transactions. Lowest priority number wins; ties by age.
 */

export type BankRuleRow = typeof finBankRules.$inferSelect;

export interface RuleTxnView {
  bankAccountId: string;
  amountCents: number;
  description: string;
  payee: string | null;
}

/** Pure: does `rule` apply to `txn`? (Case-insensitive; amount bounds use the absolute value.) */
export function ruleMatches(rule: BankRuleRow, txn: RuleTxnView): boolean {
  if (!rule.isActive) return false;
  if (rule.bankAccountId && rule.bankAccountId !== txn.bankAccountId) return false;
  if (rule.direction === "deposit" && txn.amountCents <= 0) return false;
  if (rule.direction === "withdrawal" && txn.amountCents >= 0) return false;
  const abs = Math.abs(txn.amountCents);
  if (rule.minAmountCents !== null && abs < rule.minAmountCents) return false;
  if (rule.maxAmountCents !== null && abs > rule.maxAmountCents) return false;
  const haystack = ((rule.matchField === "payee" ? txn.payee : txn.description) ?? "").trim().toLowerCase();
  const needle = rule.matchText.trim().toLowerCase();
  if (!needle) return false;
  switch (rule.matchType) {
    case "equals":
      return haystack === needle;
    case "starts_with":
      return haystack.startsWith(needle);
    default:
      return haystack.includes(needle);
  }
}

/** First matching rule from an already priority-ordered list. */
export function firstMatchingRule(rules: BankRuleRow[], txn: RuleTxnView): BankRuleRow | null {
  for (const r of rules) if (ruleMatches(r, txn)) return r;
  return null;
}

/** Active rules in evaluation order. Internal helper for sync / inbox (callers authorize). */
export async function loadActiveRules(tx: DbOrTx): Promise<BankRuleRow[]> {
  return tx
    .select()
    .from(finBankRules)
    .where(eq(finBankRules.isActive, true))
    .orderBy(asc(finBankRules.priority), asc(finBankRules.createdAt), asc(finBankRules.id));
}

/** A category must be an active, non-bank account (bank-to-bank moves are Transfers). */
export async function assertCategoryAccount(tx: DbOrTx, accountId: string): Promise<void> {
  const [a] = await tx
    .select({ isActive: finAccounts.isActive, isBank: finAccounts.isBank, name: finAccounts.name })
    .from(finAccounts)
    .where(eq(finAccounts.id, accountId))
    .limit(1);
  if (!a) throw new DalError("INVALID", "That category no longer exists.");
  if (!a.isActive) throw new DalError("INVALID", `"${a.name}" is inactive. Choose another category.`);
  if (a.isBank) throw new DalError("INVALID", "Use Transfer for money moved between your own bank accounts.");
}

export interface RuleListItem extends BankRuleRow {
  accountLabel: string;
  fundName: string | null;
  programName: string | null;
  bankAccountName: string | null;
}

export async function listRules(ctx: SessionContext): Promise<RuleListItem[]> {
  await requireFinance(ctx, "view_all");
  const rules = await db
    .select()
    .from(finBankRules)
    .orderBy(asc(finBankRules.priority), asc(finBankRules.createdAt), asc(finBankRules.id));
  if (rules.length === 0) return [];
  const accountIds = [...new Set(rules.map((r) => r.accountId))];
  const fundIds = [...new Set(rules.flatMap((r) => (r.fundId ? [r.fundId] : [])))];
  const programIds = [...new Set(rules.flatMap((r) => (r.programId ? [r.programId] : [])))];
  const bankIds = [...new Set(rules.flatMap((r) => (r.bankAccountId ? [r.bankAccountId] : [])))];
  const [accts, funds, progs, banks] = await Promise.all([
    db.select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name }).from(finAccounts).where(inArray(finAccounts.id, accountIds)),
    fundIds.length ? db.select({ id: finFunds.id, name: finFunds.name }).from(finFunds).where(inArray(finFunds.id, fundIds)) : [],
    programIds.length ? db.select({ id: programs.id, name: programs.name }).from(programs).where(inArray(programs.id, programIds)) : [],
    bankIds.length ? db.select({ id: finBankAccounts.id, name: finBankAccounts.name }).from(finBankAccounts).where(inArray(finBankAccounts.id, bankIds)) : [],
  ]);
  const a = new Map(accts.map((x) => [x.id, `${x.code} ${x.name}`]));
  const f = new Map(funds.map((x) => [x.id, x.name]));
  const p = new Map(progs.map((x) => [x.id, x.name]));
  const b = new Map(banks.map((x) => [x.id, x.name]));
  return rules.map((r) => ({
    ...r,
    accountLabel: a.get(r.accountId) ?? "(missing account)",
    fundName: r.fundId ? (f.get(r.fundId) ?? null) : null,
    programName: r.programId ? (p.get(r.programId) ?? null) : null,
    bankAccountName: r.bankAccountId ? (b.get(r.bankAccountId) ?? null) : null,
  }));
}

async function validateRefs(tx: DbOrTx, v: RuleInput): Promise<void> {
  await assertCategoryAccount(tx, v.accountId);
  if (v.fundId) {
    const [f] = await tx.select({ isActive: finFunds.isActive }).from(finFunds).where(eq(finFunds.id, v.fundId)).limit(1);
    if (!f || !f.isActive) throw new DalError("INVALID", "Choose an active fund.");
  }
  if (v.programId) {
    const [p] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, v.programId), isNull(programs.deletedAt)))
      .limit(1);
    if (!p) throw new DalError("INVALID", "That program no longer exists.");
  }
  if (v.bankAccountId) {
    const [b] = await tx.select({ id: finBankAccounts.id }).from(finBankAccounts).where(eq(finBankAccounts.id, v.bankAccountId)).limit(1);
    if (!b) throw new DalError("INVALID", "That bank account no longer exists.");
  }
}

/** Create or update (when `input.id` is set) a rule. `edit` access. */
export async function saveRule(ctx: SessionContext, input: unknown): Promise<{ id: string }> {
  await requireFinance(ctx, "edit");
  const v = ruleSchema.parse(input);
  return db.transaction(async (tx) => {
    await validateRefs(tx, v);
    const values = {
      name: v.name,
      priority: v.priority,
      matchField: v.matchField,
      matchType: v.matchType,
      matchText: v.matchText,
      direction: v.direction,
      minAmountCents: v.minAmountCents,
      maxAmountCents: v.maxAmountCents,
      bankAccountId: v.bankAccountId,
      accountId: v.accountId,
      fundId: v.fundId,
      programId: v.programId,
      memo: v.memo,
      autoPost: v.autoPost,
      isActive: v.isActive,
    };
    if (v.id) {
      const [row] = await tx.update(finBankRules).set(values).where(eq(finBankRules.id, v.id)).returning({ id: finBankRules.id });
      if (!row) throw new DalError("NOT_FOUND", "Rule not found.");
      await writeAudit(
        { actorUserId: ctx.userId, action: "finance.rule_updated", targetType: "fin_rule", targetId: row.id, metadata: { name: v.name, autoPost: v.autoPost, isActive: v.isActive } },
        tx
      );
      return { id: row.id };
    }
    const [row] = await tx
      .insert(finBankRules)
      .values({ ...values, createdByUserId: ctx.userId })
      .returning({ id: finBankRules.id });
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.rule_created", targetType: "fin_rule", targetId: row.id, metadata: { name: v.name, autoPost: v.autoPost } },
      tx
    );
    return { id: row.id };
  });
}

export async function setRuleActive(ctx: SessionContext, id: string, isActive: boolean): Promise<void> {
  await requireFinance(ctx, "edit");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(finBankRules)
      .set({ isActive })
      .where(eq(finBankRules.id, id))
      .returning({ id: finBankRules.id, name: finBankRules.name });
    if (!row) throw new DalError("NOT_FOUND", "Rule not found.");
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.rule_updated", targetType: "fin_rule", targetId: id, metadata: { name: row.name, isActive } },
      tx
    );
  });
}

/** Move a rule one step earlier/later in evaluation order (renumbers priorities 10, 20, ...). */
export async function moveRule(ctx: SessionContext, id: string, direction: "up" | "down"): Promise<void> {
  await requireFinance(ctx, "edit");
  await db.transaction(async (tx) => {
    const all = await tx
      .select({ id: finBankRules.id })
      .from(finBankRules)
      .orderBy(asc(finBankRules.priority), asc(finBankRules.createdAt), asc(finBankRules.id))
      .for("update");
    const i = all.findIndex((r) => r.id === id);
    if (i < 0) throw new DalError("NOT_FOUND", "Rule not found.");
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    for (let k = 0; k < all.length; k++) {
      await tx.update(finBankRules).set({ priority: (k + 1) * 10 }).where(eq(finBankRules.id, all[k].id));
    }
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.rule_updated", targetType: "fin_rule", targetId: id, metadata: { moved: direction } },
      tx
    );
  });
}
