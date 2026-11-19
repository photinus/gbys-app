import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { finAccounts, finPeriodCloses, finRoles, finSettings, programs, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { laToday } from "@/lib/finance/dates";
import { formatDate } from "@/lib/format";
import {
  closeBooksSchema,
  grantAccessSchema,
  reopenBooksSchema,
  revokeAccessSchema,
  settingsSchema,
  type GrantAccessInput,
  type SettingsInput,
} from "@/lib/validation/finance-gl";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import { isUniqueViolation, listProgramOptions, type ProgramOption } from "./finance-accounts";

const dateLabel = (iso: string) => formatDate(`${iso}T12:00:00`);

// ---- Settings --------------------------------------------------------------

export interface PeriodCloseRow {
  id: string;
  lockDate: string | null;
  previousLockDate: string | null;
  note: string | null;
  changedByName: string | null;
  createdAt: Date;
}

export interface FinanceSettingsView {
  fiscalYearStartMonth: number;
  lockDate: string | null;
  stripePayoutAccountId: string | null;
  autoPostStartDate: string | null;
  dualApprovalThresholdCents: number | null;
  updatedAt: Date;
  updatedByName: string | null;
  /** Active bank/cash accounts Stripe payouts can land in. */
  bankAccounts: { id: string; code: string; name: string }[];
  closes: PeriodCloseRow[];
}

export async function getFinanceSettings(ctx: SessionContext): Promise<FinanceSettingsView> {
  await requireFinance(ctx, "admin");
  const [row] = await db
    .select({ s: finSettings, updatedByName: users.name })
    .from(finSettings)
    .leftJoin(users, eq(users.id, finSettings.updatedByUserId))
    .where(eq(finSettings.id, 1))
    .limit(1);
  if (!row) throw new Error("fin_settings row is missing (migration 0014 seeds it).");
  const [bankAccounts, closes] = await Promise.all([
    db
      .select({ id: finAccounts.id, code: finAccounts.code, name: finAccounts.name })
      .from(finAccounts)
      .where(and(eq(finAccounts.isBank, true), eq(finAccounts.isActive, true), eq(finAccounts.type, "asset")))
      .orderBy(asc(finAccounts.code)),
    db
      .select({
        id: finPeriodCloses.id,
        lockDate: finPeriodCloses.lockDate,
        previousLockDate: finPeriodCloses.previousLockDate,
        note: finPeriodCloses.note,
        changedByName: users.name,
        createdAt: finPeriodCloses.createdAt,
      })
      .from(finPeriodCloses)
      .leftJoin(users, eq(users.id, finPeriodCloses.changedByUserId))
      .orderBy(desc(finPeriodCloses.createdAt))
      .limit(25),
  ]);
  return {
    fiscalYearStartMonth: row.s.fiscalYearStartMonth,
    lockDate: row.s.lockDate,
    stripePayoutAccountId: row.s.stripePayoutAccountId,
    autoPostStartDate: row.s.autoPostStartDate,
    dualApprovalThresholdCents: row.s.dualApprovalThresholdCents,
    updatedAt: row.s.updatedAt,
    updatedByName: row.updatedByName,
    bankAccounts,
    closes,
  };
}

export async function updateFinanceSettings(ctx: SessionContext, input: SettingsInput): Promise<{ changed: string[] }> {
  await requireFinance(ctx, "admin");
  const d = settingsSchema.parse(input);
  if (d.dualApprovalThresholdDollars !== null && d.dualApprovalThresholdDollars > 100_000_000) {
    throw new DalError("INVALID", "That threshold is too large.");
  }
  return db.transaction(async (tx) => {
    const [old] = await tx.select().from(finSettings).where(eq(finSettings.id, 1)).for("update").limit(1);
    if (!old) throw new Error("fin_settings row is missing.");
    if (d.stripePayoutAccountId) {
      const [a] = await tx
        .select({ id: finAccounts.id })
        .from(finAccounts)
        .where(
          and(
            eq(finAccounts.id, d.stripePayoutAccountId),
            eq(finAccounts.isBank, true),
            eq(finAccounts.isActive, true),
            eq(finAccounts.type, "asset")
          )
        )
        .limit(1);
      if (!a) throw new DalError("INVALID", "Pick an active bank account for Stripe payouts.");
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const cmp = (k: string, from: unknown, to: unknown) => {
      if ((from ?? null) !== (to ?? null)) changes[k] = { from: from ?? null, to: to ?? null };
    };
    cmp("fiscalYearStartMonth", old.fiscalYearStartMonth, d.fiscalYearStartMonth);
    cmp("stripePayoutAccountId", old.stripePayoutAccountId, d.stripePayoutAccountId);
    cmp("autoPostStartDate", old.autoPostStartDate, d.autoPostStartDate);
    cmp("dualApprovalThresholdCents", old.dualApprovalThresholdCents, d.dualApprovalThresholdDollars);
    const changed = Object.keys(changes);
    if (changed.length === 0) return { changed };
    await tx
      .update(finSettings)
      .set({
        fiscalYearStartMonth: d.fiscalYearStartMonth,
        stripePayoutAccountId: d.stripePayoutAccountId,
        autoPostStartDate: d.autoPostStartDate,
        dualApprovalThresholdCents: d.dualApprovalThresholdDollars,
        updatedByUserId: ctx.userId,
      })
      .where(eq(finSettings.id, 1));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.settings_updated",
        targetType: "fin_settings",
        targetId: "1",
        metadata: { fields: changed, changes },
      },
      tx
    );
    return { changed };
  });
}

/** Close the books through `lockDate` (inclusive). Can only move forward; use reopenBooks to go back. */
export async function closeBooks(ctx: SessionContext, input: { lockDate: string; note?: string | null }): Promise<void> {
  await requireFinance(ctx, "admin");
  const d = closeBooksSchema.parse(input);
  if (d.lockDate > laToday()) throw new DalError("INVALID", "You can only close the books through today or an earlier date.");
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(finSettings).where(eq(finSettings.id, 1)).for("update").limit(1);
    if (!cur) throw new Error("fin_settings row is missing.");
    if (cur.lockDate && d.lockDate <= cur.lockDate) {
      throw new DalError(
        "INVALID",
        cur.lockDate === d.lockDate
          ? `The books are already closed through ${dateLabel(cur.lockDate)}.`
          : `The books are already closed through ${dateLabel(cur.lockDate)}. To go back to an earlier date, use "Reopen".`
      );
    }
    await tx.update(finSettings).set({ lockDate: d.lockDate, updatedByUserId: ctx.userId }).where(eq(finSettings.id, 1));
    await tx.insert(finPeriodCloses).values({
      lockDate: d.lockDate,
      previousLockDate: cur.lockDate,
      note: d.note,
      changedByUserId: ctx.userId,
    });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.period_closed",
        targetType: "fin_settings",
        targetId: "1",
        metadata: { lockDate: d.lockDate, previousLockDate: cur.lockDate, note: d.note },
      },
      tx
    );
  });
}

/** Move the close date earlier (or clear it with a null date). A reason is required. */
export async function reopenBooks(ctx: SessionContext, input: { lockDate?: string | null; reason: string }): Promise<void> {
  await requireFinance(ctx, "admin");
  const d = reopenBooksSchema.parse(input);
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(finSettings).where(eq(finSettings.id, 1)).for("update").limit(1);
    if (!cur) throw new Error("fin_settings row is missing.");
    if (!cur.lockDate) throw new DalError("INVALID", "The books aren't closed.");
    if (d.lockDate && d.lockDate >= cur.lockDate) {
      throw new DalError("INVALID", `Pick a date before ${dateLabel(cur.lockDate)}, or choose to reopen everything.`);
    }
    await tx.update(finSettings).set({ lockDate: d.lockDate, updatedByUserId: ctx.userId }).where(eq(finSettings.id, 1));
    await tx.insert(finPeriodCloses).values({
      lockDate: d.lockDate,
      previousLockDate: cur.lockDate,
      note: d.reason,
      changedByUserId: ctx.userId,
    });
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.period_reopened",
        targetType: "fin_settings",
        targetId: "1",
        metadata: { lockDate: d.lockDate, previousLockDate: cur.lockDate, reason: d.reason },
      },
      tx
    );
  });
}

// ---- Access ----------------------------------------------------------------

export interface ImplicitAccessRow {
  userId: string;
  name: string;
  email: string;
  level: "admin" | "viewer";
  via: "super_admin" | "board_member";
}

export interface ExplicitGrantRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer";
  programId: string | null;
  programName: string | null;
  createdAt: Date;
  grantedByName: string | null;
}

export interface AccessOverview {
  implicit: ImplicitAccessRow[];
  grants: ExplicitGrantRow[];
  programs: ProgramOption[];
  currentUserId: string;
}

export async function getAccessOverview(ctx: SessionContext): Promise<AccessOverview> {
  await requireFinance(ctx, "admin");
  const grantor = sql<string | null>`(select g.name from ${users} g where g.id = ${finRoles.grantedByUserId})`;
  const [implicitRows, grants, progs] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email, orgRole: users.orgRole })
      .from(users)
      .where(and(isNull(users.deletedAt), inArray(users.orgRole, ["super_admin", "board_member"])))
      .orderBy(asc(users.name)),
    db
      .select({
        id: finRoles.id,
        userId: finRoles.userId,
        name: users.name,
        email: users.email,
        role: finRoles.role,
        programId: finRoles.programId,
        programName: programs.name,
        createdAt: finRoles.createdAt,
        grantedByName: grantor,
      })
      .from(finRoles)
      .innerJoin(users, eq(users.id, finRoles.userId))
      .leftJoin(programs, eq(programs.id, finRoles.programId))
      .where(isNull(finRoles.revokedAt))
      .orderBy(asc(users.name), asc(finRoles.createdAt)),
    listProgramOptions(),
  ]);
  return {
    implicit: implicitRows.map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      level: u.orgRole === "super_admin" ? ("admin" as const) : ("viewer" as const),
      via: u.orgRole as "super_admin" | "board_member",
    })),
    grants,
    programs: progs,
    currentUserId: ctx.userId,
  };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Active users matching a name/email fragment, for the "give access" picker. */
export async function searchFinanceUsers(
  ctx: SessionContext,
  q: string
): Promise<{ id: string; name: string; email: string }[]> {
  await requireFinance(ctx, "admin");
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = `%${escapeLike(term)}%`;
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(isNull(users.deletedAt), or(ilike(users.name, like), ilike(users.email, like))))
    .orderBy(asc(users.name))
    .limit(8);
}

export async function grantFinanceAccess(ctx: SessionContext, input: GrantAccessInput): Promise<{ id: string }> {
  await requireFinance(ctx, "admin");
  const d = grantAccessSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [u] = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.id, d.userId), isNull(users.deletedAt)))
        .limit(1);
      if (!u) throw new DalError("INVALID", "That person wasn't found or is deactivated.");
      let programName: string | null = null;
      if (d.programId) {
        const [p] = await tx
          .select({ name: programs.name })
          .from(programs)
          .where(and(eq(programs.id, d.programId), isNull(programs.deletedAt)))
          .limit(1);
        if (!p) throw new DalError("INVALID", "Program not found.");
        programName = p.name;
      }
      const [existing] = await tx
        .select({ id: finRoles.id, role: finRoles.role })
        .from(finRoles)
        .where(
          and(
            eq(finRoles.userId, d.userId),
            isNull(finRoles.revokedAt),
            d.programId ? eq(finRoles.programId, d.programId) : isNull(finRoles.programId)
          )
        )
        .limit(1);
      if (existing) {
        throw new DalError(
          "INVALID",
          `${u.name} already has ${d.programId ? `access to ${programName}` : "organization-wide access"} (${existing.role}). Remove it first to change their role.`
        );
      }
      const [row] = await tx
        .insert(finRoles)
        .values({ userId: d.userId, role: d.role, programId: d.programId, grantedByUserId: ctx.userId })
        .returning({ id: finRoles.id });
      await writeAudit(
        {
          actorUserId: ctx.userId,
          action: "finance.access_granted",
          targetType: "fin_role",
          targetId: row.id,
          metadata: { userId: d.userId, role: d.role, programId: d.programId },
        },
        tx
      );
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DalError("INVALID", "That person already has this access.");
    throw e;
  }
}

export async function revokeFinanceAccess(ctx: SessionContext, input: { grantId: string }): Promise<void> {
  await requireFinance(ctx, "admin");
  const d = revokeAccessSchema.parse(input);
  await db.transaction(async (tx) => {
    const [g] = await tx.select().from(finRoles).where(eq(finRoles.id, d.grantId)).for("update").limit(1);
    if (!g || g.revokedAt) throw new DalError("NOT_FOUND", "That access has already been removed.");
    if (g.userId === ctx.userId && g.role === "admin" && g.programId === null && ctx.orgRole !== "super_admin") {
      throw new DalError("INVALID", "You can't remove your own admin access. Ask another finance admin to do it.");
    }
    await tx
      .update(finRoles)
      .set({ revokedAt: new Date(), revokedByUserId: ctx.userId })
      .where(eq(finRoles.id, d.grantId));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.access_revoked",
        targetType: "fin_role",
        targetId: d.grantId,
        metadata: { userId: g.userId, role: g.role, programId: g.programId },
      },
      tx
    );
  });
}
