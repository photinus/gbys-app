import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { finAccounts, finBankAccounts, finFunds, finSettings, programs } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  ACCOUNT_TYPES,
  accountSchema,
  fundSchema,
  setActiveSchema,
  updateAccountSchema,
  updateFundSchema,
  type AccountInput,
  type FundInput,
  type RestrictionValue,
} from "@/lib/validation/finance-gl";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import { naturalBalance, sumLines, type FinAccountType } from "./finance-ledger";

/** True when a Postgres unique-index violation (possibly wrapped by drizzle) was raised. */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: FinAccountType;
  subtype: string | null;
  description: string | null;
  systemKey: string | null;
  isBank: boolean;
  is1099: boolean;
  isActive: boolean;
  /** Natural balance in cents (assets/expenses: debits - credits; others: credits - debits). */
  balanceCents: number;
  /** Number of journal lines (including voided entries) — type can't change once > 0. */
  lineCount: number;
}

export interface FundRow {
  id: string;
  name: string;
  code: string | null;
  restriction: RestrictionValue;
  programId: string | null;
  programName: string | null;
  purpose: string | null;
  systemKey: string | null;
  isActive: boolean;
  /** Money received into the fund (revenue lines). */
  receivedCents: number;
  /** Money spent from the fund (expense lines). */
  spentCents: number;
  /** Opening net-asset balances posted to the fund. */
  openingCents: number;
  /** received + opening - spent. */
  balanceCents: number;
  lineCount: number;
}

export interface ProgramOption {
  id: string;
  name: string;
}

export async function listProgramOptions(): Promise<ProgramOption[]> {
  return db
    .select({ id: programs.id, name: programs.name })
    .from(programs)
    .where(isNull(programs.deletedAt))
    .orderBy(asc(programs.name));
}

async function lineCountsBy(column: "account_id" | "fund_id"): Promise<Map<string, number>> {
  const col = sql.raw(column);
  const rows = await db.execute<{ id: string; n: string }>(
    sql`select ${col} as id, count(*)::text as n from fin_journal_lines group by ${col}`
  );
  return new Map(rows.rows.map((r) => [r.id, Number(r.n)]));
}

/** Chart of accounts with live balances (`view_all`). */
export async function listAccounts(ctx: SessionContext): Promise<AccountRow[]> {
  await requireFinance(ctx, "view_all");
  const [accts, totals, counts] = await Promise.all([
    db.select().from(finAccounts).orderBy(asc(finAccounts.code)),
    sumLines(db),
    lineCountsBy("account_id"),
  ]);
  const byAccount = new Map<string, { d: number; c: number }>();
  for (const t of totals) {
    const cur = byAccount.get(t.accountId) ?? { d: 0, c: 0 };
    cur.d += t.debitCents;
    cur.c += t.creditCents;
    byAccount.set(t.accountId, cur);
  }
  return accts.map((a) => {
    const t = byAccount.get(a.id) ?? { d: 0, c: 0 };
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      description: a.description,
      systemKey: a.systemKey,
      isBank: a.isBank,
      is1099: a.is1099,
      isActive: a.isActive,
      balanceCents: naturalBalance(a.type, t.d, t.c),
      lineCount: counts.get(a.id) ?? 0,
    };
  });
}

/** Funds with balances (`view_all`). */
export async function listFunds(ctx: SessionContext): Promise<FundRow[]> {
  await requireFinance(ctx, "view_all");
  const [funds, totals, counts, accts] = await Promise.all([
    db
      .select({ f: finFunds, programName: programs.name })
      .from(finFunds)
      .leftJoin(programs, eq(programs.id, finFunds.programId))
      .orderBy(asc(finFunds.name)),
    sumLines(db),
    lineCountsBy("fund_id"),
    db.select({ id: finAccounts.id, type: finAccounts.type }).from(finAccounts),
  ]);
  const typeOf = new Map(accts.map((a) => [a.id, a.type]));
  const agg = new Map<string, { received: number; spent: number; opening: number }>();
  for (const t of totals) {
    const type = typeOf.get(t.accountId);
    if (!type) continue;
    const cur = agg.get(t.fundId) ?? { received: 0, spent: 0, opening: 0 };
    if (type === "revenue") cur.received += t.creditCents - t.debitCents;
    else if (type === "expense") cur.spent += t.debitCents - t.creditCents;
    else if (type === "net_assets") cur.opening += t.creditCents - t.debitCents;
    agg.set(t.fundId, cur);
  }
  return funds.map(({ f, programName }) => {
    const a = agg.get(f.id) ?? { received: 0, spent: 0, opening: 0 };
    return {
      id: f.id,
      name: f.name,
      code: f.code,
      restriction: f.restriction,
      programId: f.programId,
      programName,
      purpose: f.purpose,
      systemKey: f.systemKey,
      isActive: f.isActive,
      receivedCents: a.received,
      spentCents: a.spent,
      openingCents: a.opening,
      balanceCents: a.received + a.opening - a.spent,
      lineCount: counts.get(f.id) ?? 0,
    };
  });
}

/** Every account (active or not) as a plain id/code/name list, e.g. for filter dropdowns. */
export async function listAccountChoices(ctx: SessionContext): Promise<{ id: string; code: string; name: string; isActive: boolean }[]> {
  await requireFinance(ctx, "view_all");
  return db
    .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name, isActive: finAccounts.isActive })
    .from(finAccounts)
    .orderBy(asc(finAccounts.code));
}

// ---- Posting options (reusable by any entry form) --------------------------

export interface PostingAccountOption {
  id: string;
  code: string;
  name: string;
  subtype: string | null;
  type: FinAccountType;
  isBank: boolean;
}
export interface PostingOptions {
  /** Active accounts grouped by type, in chart order. */
  accountGroups: { type: FinAccountType; accounts: PostingAccountOption[] }[];
  funds: { id: string; name: string; restriction: RestrictionValue; programId: string | null }[];
  programs: ProgramOption[];
  generalFundId: string;
}

/**
 * Everything an entry form needs to render its dropdowns: active accounts grouped by
 * type, active funds and programs. Read-only; requires org-wide read access.
 */
export async function getPostingOptions(ctx: SessionContext): Promise<PostingOptions> {
  await requireFinance(ctx, "view_all");
  const [accts, funds, progs] = await Promise.all([
    db
      .select({
        id: finAccounts.id,
        code: finAccounts.code,
        name: finAccounts.name,
        subtype: finAccounts.subtype,
        type: finAccounts.type,
        isBank: finAccounts.isBank,
      })
      .from(finAccounts)
      .where(eq(finAccounts.isActive, true))
      .orderBy(asc(finAccounts.code)),
    db
      .select({
        id: finFunds.id,
        name: finFunds.name,
        restriction: finFunds.restriction,
        programId: finFunds.programId,
        systemKey: finFunds.systemKey,
      })
      .from(finFunds)
      .where(eq(finFunds.isActive, true))
      .orderBy(asc(finFunds.name)),
    listProgramOptions(),
  ]);
  const general = funds.find((f) => f.systemKey === "general");
  if (!general) throw new Error("General Fund is missing (migration 0014 seeds it).");
  return {
    accountGroups: ACCOUNT_TYPES.map((type) => ({ type, accounts: accts.filter((a) => a.type === type) })).filter(
      (g) => g.accounts.length > 0
    ),
    funds: funds.map(({ systemKey: _s, ...f }) => f),
    programs: progs,
    generalFundId: general.id,
  };
}

// ---- Account writes --------------------------------------------------------

export async function createAccount(ctx: SessionContext, input: AccountInput): Promise<{ id: string }> {
  await requireFinance(ctx, "edit");
  const d = accountSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(finAccounts)
        .values({
          code: d.code,
          name: d.name,
          type: d.type,
          subtype: d.subtype,
          description: d.description,
          isBank: d.isBank,
          is1099: d.is1099 && d.type === "expense",
        })
        .returning({ id: finAccounts.id });
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "finance.account_created",
          targetType: "fin_account",
          targetId: row.id,
          metadata: { code: d.code, name: d.name, type: d.type },
        },
        tx
      );
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DalError("INVALID", `Account number ${d.code} is already in use.`);
    throw e;
  }
}

export async function updateAccount(ctx: SessionContext, input: AccountInput & { id: string }): Promise<void> {
  await requireFinance(ctx, "edit");
  const d = updateAccountSchema.parse(input);
  try {
    await db.transaction(async (tx) => {
      const [old] = await tx.select().from(finAccounts).where(eq(finAccounts.id, d.id)).for("update").limit(1);
      if (!old) throw new DalError("NOT_FOUND", "Account not found.");
      if (d.type !== old.type) {
        if (old.systemKey) throw new DalError("INVALID", "This is a built-in account, so its type can't be changed.");
        const [used] = await tx.execute<{ n: string }>(
          sql`select count(*)::text as n from fin_journal_lines where account_id = ${d.id}::uuid`
        ).then((r) => r.rows);
        if (Number(used.n) > 0) {
          throw new DalError("INVALID", "This account already has transactions, so its type can't be changed.");
        }
      }
      if (!d.isBank && old.isBank) {
        const [mapped] = await tx
          .select({ id: finBankAccounts.id })
          .from(finBankAccounts)
          .where(and(eq(finBankAccounts.glAccountId, d.id), eq(finBankAccounts.isActive, true)))
          .limit(1);
        if (mapped) throw new DalError("INVALID", "A bank feed is linked to this account, so it must stay a bank account.");
      }
      const changed: string[] = [];
      if (old.code !== d.code) changed.push("code");
      if (old.name !== d.name) changed.push("name");
      if (old.type !== d.type) changed.push("type");
      if ((old.subtype ?? null) !== d.subtype) changed.push("subtype");
      if ((old.description ?? null) !== d.description) changed.push("description");
      if (old.isBank !== d.isBank) changed.push("isBank");
      const is1099 = d.is1099 && d.type === "expense";
      if (old.is1099 !== is1099) changed.push("is1099");
      if (changed.length === 0) return;
      await tx
        .update(finAccounts)
        .set({
          code: d.code,
          name: d.name,
          type: d.type,
          subtype: d.subtype,
          description: d.description,
          isBank: d.isBank,
          is1099,
        })
        .where(eq(finAccounts.id, d.id));
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "finance.account_updated",
          targetType: "fin_account",
          targetId: d.id,
          metadata: { fields: changed, code: d.code },
        },
        tx
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DalError("INVALID", `Account number ${d.code} is already in use.`);
    throw e;
  }
}

export async function setAccountActive(ctx: SessionContext, input: { id: string; isActive: boolean }): Promise<void> {
  await requireFinance(ctx, "edit");
  const d = setActiveSchema.parse(input);
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(finAccounts).where(eq(finAccounts.id, d.id)).for("update").limit(1);
    if (!old) throw new DalError("NOT_FOUND", "Account not found.");
    if (old.isActive === d.isActive) return;
    if (!d.isActive) {
      if (old.systemKey) {
        throw new DalError("INVALID", `"${old.name}" is a built-in account that the app posts to, so it can't be turned off.`);
      }
      const [mapped] = await tx
        .select({ id: finBankAccounts.id })
        .from(finBankAccounts)
        .where(and(eq(finBankAccounts.glAccountId, d.id), eq(finBankAccounts.isActive, true)))
        .limit(1);
      if (mapped) throw new DalError("INVALID", "A bank feed is linked to this account, so it can't be turned off.");
      const [payout] = await tx
        .select({ id: finSettings.id })
        .from(finSettings)
        .where(eq(finSettings.stripePayoutAccountId, d.id))
        .limit(1);
      if (payout) throw new DalError("INVALID", "This is the account Stripe payouts land in. Choose another one in Finance settings first.");
    }
    await tx.update(finAccounts).set({ isActive: d.isActive }).where(eq(finAccounts.id, d.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.account_updated",
        targetType: "fin_account",
        targetId: d.id,
        metadata: { fields: ["isActive"], isActive: d.isActive, code: old.code },
      },
      tx
    );
  });
}

// ---- Fund writes -----------------------------------------------------------

async function assertFundProgram(
  tx: Pick<typeof db, "select">,
  restriction: RestrictionValue,
  programId: string | null
): Promise<void> {
  if (!programId) return;
  if (restriction !== "with_donor_restrictions") {
    throw new DalError("INVALID", "Only donor-restricted funds can be tied to a program.");
  }
  const [p] = await tx
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.id, programId), isNull(programs.deletedAt)))
    .limit(1);
  if (!p) throw new DalError("INVALID", "Program not found.");
}

export async function createFund(ctx: SessionContext, input: FundInput): Promise<{ id: string }> {
  await requireFinance(ctx, "edit");
  const d = fundSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      await assertFundProgram(tx, d.restriction, d.programId);
      const [row] = await tx
        .insert(finFunds)
        .values({ name: d.name, code: d.code, restriction: d.restriction, programId: d.programId, purpose: d.purpose })
        .returning({ id: finFunds.id });
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "finance.fund_created",
          targetType: "fin_fund",
          targetId: row.id,
          metadata: { name: d.name, restriction: d.restriction, programId: d.programId },
        },
        tx
      );
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DalError("INVALID", `A fund named "${d.name}" already exists.`);
    throw e;
  }
}

export async function updateFund(ctx: SessionContext, input: FundInput & { id: string }): Promise<void> {
  await requireFinance(ctx, "edit");
  const d = updateFundSchema.parse(input);
  try {
    await db.transaction(async (tx) => {
      const [old] = await tx.select().from(finFunds).where(eq(finFunds.id, d.id)).for("update").limit(1);
      if (!old) throw new DalError("NOT_FOUND", "Fund not found.");
      if (d.restriction !== old.restriction) {
        if (old.systemKey) throw new DalError("INVALID", "The General Fund is always unrestricted.");
        const [used] = await tx
          .execute<{ n: string }>(sql`select count(*)::text as n from fin_journal_lines where fund_id = ${d.id}::uuid`)
          .then((r) => r.rows);
        if (Number(used.n) > 0) {
          throw new DalError(
            "INVALID",
            "This fund already has transactions, so it can't switch between restricted and unrestricted. Create a new fund instead."
          );
        }
      }
      if (old.systemKey && d.programId) throw new DalError("INVALID", "The General Fund can't be tied to a program.");
      await assertFundProgram(tx, d.restriction, d.programId);
      const changed: string[] = [];
      if (old.name !== d.name) changed.push("name");
      if ((old.code ?? null) !== d.code) changed.push("code");
      if (old.restriction !== d.restriction) changed.push("restriction");
      if ((old.programId ?? null) !== d.programId) changed.push("programId");
      if ((old.purpose ?? null) !== d.purpose) changed.push("purpose");
      if (changed.length === 0) return;
      await tx
        .update(finFunds)
        .set({ name: d.name, code: d.code, restriction: d.restriction, programId: d.programId, purpose: d.purpose })
        .where(eq(finFunds.id, d.id));
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "finance.fund_updated",
          targetType: "fin_fund",
          targetId: d.id,
          metadata: { fields: changed, name: d.name },
        },
        tx
      );
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DalError("INVALID", `A fund named "${d.name}" already exists.`);
    throw e;
  }
}

export async function setFundActive(ctx: SessionContext, input: { id: string; isActive: boolean }): Promise<void> {
  await requireFinance(ctx, "edit");
  const d = setActiveSchema.parse(input);
  await db.transaction(async (tx) => {
    const [old] = await tx.select().from(finFunds).where(eq(finFunds.id, d.id)).for("update").limit(1);
    if (!old) throw new DalError("NOT_FOUND", "Fund not found.");
    if (old.isActive === d.isActive) return;
    if (!d.isActive && old.systemKey) throw new DalError("INVALID", "The General Fund can't be turned off.");
    await tx.update(finFunds).set({ isActive: d.isActive }).where(eq(finFunds.id, d.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.fund_updated",
        targetType: "fin_fund",
        targetId: d.id,
        metadata: { fields: ["isActive"], isActive: d.isActive, name: old.name },
      },
      tx
    );
  });
}
