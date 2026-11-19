import "server-only";
import { cache } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { finRoles } from "@/db/schema";
import { DalError, type SessionContext } from "./context";

/**
 * Finance (accounting) access — orchestrator-owned shared contract.
 *
 * Org-wide levels (programId null on fin_roles):
 *   admin  — everything: settings, period close/reopen, access grants, bank connections.
 *   editor — bookkeeping: bank inbox, journal entries, rules, reconciliation, accounts & funds.
 *   viewer — read-only: all reports, journal, bank feed.
 * Program-scoped grants (programId set): editor | viewer, limited to journal lines whose
 * program class is that program (reports filter to those lines). In Finance 1 a program
 * editor reads like a program viewer; Finance 2 lets them submit bills/reimbursements.
 *
 * Implicit: super_admin = finance admin; board_member = org-wide viewer. An explicit
 * org-wide grant raises (never lowers) the implicit level.
 */

export type FinanceLevel = "admin" | "editor" | "viewer";

export interface FinanceProgramGrant {
  programId: string;
  role: "editor" | "viewer";
}

export interface FinanceAccess {
  /** Org-wide level, or null when the user only has program grants (or nothing). */
  level: FinanceLevel | null;
  programs: FinanceProgramGrant[];
}

const RANK: Record<FinanceLevel, number> = { viewer: 1, editor: 2, admin: 3 };

function maxLevel(a: FinanceLevel | null, b: FinanceLevel | null): FinanceLevel | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

const loadGrants = cache(async (userId: string) =>
  db
    .select({ role: finRoles.role, programId: finRoles.programId })
    .from(finRoles)
    .where(and(eq(finRoles.userId, userId), isNull(finRoles.revokedAt)))
);

export async function getFinanceAccess(ctx: SessionContext): Promise<FinanceAccess> {
  const grants = await loadGrants(ctx.userId);
  let level: FinanceLevel | null =
    ctx.orgRole === "super_admin" ? "admin" : ctx.orgRole === "board_member" ? "viewer" : null;
  const programs: FinanceProgramGrant[] = [];
  for (const g of grants) {
    if (g.programId === null) level = maxLevel(level, g.role);
    else if (g.role !== "admin") programs.push({ programId: g.programId, role: g.role });
  }
  return { level, programs };
}

export function hasFinanceAccess(a: FinanceAccess): boolean {
  return a.level !== null || a.programs.length > 0;
}

export function isFinanceAdmin(a: FinanceAccess): boolean {
  return a.level === "admin";
}

/** Org-wide bookkeeping writes (admin or editor). */
export function canEditBooks(a: FinanceAccess): boolean {
  return a.level === "admin" || a.level === "editor";
}

/** Org-wide read (bank feed, full journal, balance sheet). */
export function canViewAllFinance(a: FinanceAccess): boolean {
  return a.level !== null;
}

/** Program classes whose lines the user may read: "all" for any org-wide level. */
export function viewableProgramIds(a: FinanceAccess): "all" | string[] {
  if (a.level !== null) return "all";
  return [...new Set(a.programs.map((p) => p.programId))];
}

export function canViewProgramFinance(a: FinanceAccess, programId: string): boolean {
  return a.level !== null || a.programs.some((p) => p.programId === programId);
}

/** Finance 2: submit bills / reimbursements / invoices for a program. */
export function canEditProgramFinance(a: FinanceAccess, programId: string): boolean {
  return canEditBooks(a) || a.programs.some((p) => p.programId === programId && p.role === "editor");
}

export type FinanceNeed = "any" | "view_all" | "edit" | "admin";

/**
 * Authorize inside every finance DAL function:
 *   "any"      — any finance access (program-scoped included; filter with viewableProgramIds)
 *   "view_all" — org-wide read
 *   "edit"     — org-wide bookkeeping writes
 *   "admin"    — finance admin
 */
export async function requireFinance(ctx: SessionContext, need: FinanceNeed): Promise<FinanceAccess> {
  const a = await getFinanceAccess(ctx);
  const ok =
    need === "any"
      ? hasFinanceAccess(a)
      : need === "view_all"
        ? canViewAllFinance(a)
        : need === "edit"
          ? canEditBooks(a)
          : isFinanceAdmin(a);
  if (!ok) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
  return a;
}

// ---- Finance 2 -------------------------------------------------------------

/** Approve / reject bills and reimbursements (never one you created, submitted or are paid by). */
export function canApproveBills(a: FinanceAccess): boolean {
  return canEditBooks(a);
}

/**
 * Create / submit a bill for a program (programId) or organization-wide (null).
 * Program editors may only submit bills whose header AND lines are their program.
 */
export function canSubmitBillFor(a: FinanceAccess, programId: string | null): boolean {
  if (canEditBooks(a)) return true;
  return programId !== null && a.programs.some((p) => p.programId === programId && p.role === "editor");
}

/** Read bills of a program (program viewers/editors) or all (org-wide). */
export function canViewBillsFor(a: FinanceAccess, programId: string | null): boolean {
  if (a.level !== null) return true;
  return programId !== null && a.programs.some((p) => p.programId === programId);
}
