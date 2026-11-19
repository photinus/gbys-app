import "server-only";
import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { finAccounts, finContacts, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "@/lib/crypto";
import { contactInputSchema, taxIdInputSchema, type ContactInput } from "@/lib/validation/finance-contacts";
import { DalError, type SessionContext } from "./context";
import { canEditBooks, getFinanceAccess, requireFinance, type FinanceAccess } from "./finance-access";

/**
 * Finance contacts (vendors, customers, donors) — shared contract (orchestrator).
 * Tax ids are encrypted and only ever returned as last-4, except revealTaxId
 * (finance admin, audited). Program editors may look up and create vendors
 * (for submitting their program's bills) but never see or set tax data.
 */

export type ContactRole = "vendor" | "customer" | "donor";

export interface ContactListRow {
  id: string;
  displayName: string;
  kind: string;
  email: string | null;
  isVendor: boolean;
  isCustomer: boolean;
  isDonor: boolean;
  is1099: boolean;
  isActive: boolean;
  userId: string | null;
}

export interface ContactDetail extends ContactListRow {
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  taxIdType: string | null;
  taxIdLast4: string | null;
  w9ReceivedOn: string | null;
  defaultAccountId: string | null;
  notes: string | null;
  createdAt: Date;
}

const listCols = {
  id: finContacts.id,
  displayName: finContacts.displayName,
  kind: finContacts.kind,
  email: finContacts.email,
  isVendor: finContacts.isVendor,
  isCustomer: finContacts.isCustomer,
  isDonor: finContacts.isDonor,
  is1099: finContacts.is1099,
  isActive: finContacts.isActive,
  userId: finContacts.userId,
};

function isProgramEditor(a: FinanceAccess): boolean {
  return a.programs.some((p) => p.role === "editor");
}

/** Org-wide readers, or program editors (vendor lookup for bills). */
async function requireContactRead(ctx: SessionContext): Promise<FinanceAccess> {
  const a = await getFinanceAccess(ctx);
  if (a.level === null && !isProgramEditor(a)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
  return a;
}

function roleCond(role?: ContactRole): SQL | undefined {
  if (role === "vendor") return eq(finContacts.isVendor, true);
  if (role === "customer") return eq(finContacts.isCustomer, true);
  if (role === "donor") return eq(finContacts.isDonor, true);
  return undefined;
}

export async function listContacts(
  ctx: SessionContext,
  opts: { role?: ContactRole; q?: string; includeInactive?: boolean; limit?: number } = {}
): Promise<ContactListRow[]> {
  const a = await requireContactRead(ctx);
  // Program editors only ever see vendors.
  const role = a.level === null ? "vendor" : opts.role;
  const conds: (SQL | undefined)[] = [roleCond(role)];
  if (!opts.includeInactive) conds.push(eq(finContacts.isActive, true));
  const q = opts.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(finContacts.displayName, like), ilike(finContacts.email, like)));
  }
  return db
    .select(listCols)
    .from(finContacts)
    .where(and(...conds))
    .orderBy(asc(finContacts.displayName))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
}

export async function getContact(ctx: SessionContext, id: string, tx: DbOrTx = db): Promise<ContactDetail> {
  await requireFinance(ctx, "view_all");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DalError("NOT_FOUND", "Contact not found.");
  const [row] = await tx
    .select({
      ...listCols,
      phone: finContacts.phone,
      addressLine1: finContacts.addressLine1,
      addressLine2: finContacts.addressLine2,
      city: finContacts.city,
      state: finContacts.state,
      postalCode: finContacts.postalCode,
      taxIdType: finContacts.taxIdType,
      taxIdLast4: finContacts.taxIdLast4,
      w9ReceivedOn: finContacts.w9ReceivedOn,
      defaultAccountId: finContacts.defaultAccountId,
      notes: finContacts.notes,
      createdAt: finContacts.createdAt,
    })
    .from(finContacts)
    .where(eq(finContacts.id, id))
    .limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Contact not found.");
  return row;
}

async function assertDefaultAccount(tx: DbOrTx, accountId: string | null | undefined): Promise<void> {
  if (!accountId) return;
  const [acct] = await tx.select({ isActive: finAccounts.isActive }).from(finAccounts).where(eq(finAccounts.id, accountId)).limit(1);
  if (!acct?.isActive) throw new DalError("INVALID", "Pick an active default category.");
}

/**
 * Create a contact. Bookkeepers: any role. Program editors: vendor only, no 1099 flag.
 * Pass `tx` to create inside a caller's transaction (e.g. a new donor while recording a gift).
 */
export async function createContact(ctx: SessionContext, input: ContactInput, tx?: DbOrTx): Promise<{ id: string }> {
  const a = await requireContactRead(ctx);
  const data = contactInputSchema.parse(input);
  if (!canEditBooks(a)) {
    if (data.isCustomer || data.isDonor || data.is1099) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
    data.isVendor = true;
  }
  if (!data.isVendor && !data.isCustomer && !data.isDonor) throw new DalError("INVALID", "Pick at least one role.");
  const run = async (t: DbOrTx) => {
    await assertDefaultAccount(t, data.defaultAccountId);
    const [row] = await t
      .insert(finContacts)
      .values({ ...data, defaultAccountId: data.defaultAccountId ?? null, createdByUserId: ctx.userId })
      .returning({ id: finContacts.id });
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.contact_created", targetType: "fin_contact", targetId: row.id, metadata: { name: data.displayName } },
      t
    );
    return row;
  };
  return tx ? run(tx) : db.transaction(run);
}

export async function updateContact(ctx: SessionContext, id: string, input: ContactInput & { isActive?: boolean }): Promise<void> {
  await requireFinance(ctx, "edit");
  const data = contactInputSchema.parse(input);
  if (!data.isVendor && !data.isCustomer && !data.isDonor) throw new DalError("INVALID", "Pick at least one role.");
  await db.transaction(async (tx) => {
    const before = await getContact(ctx, id, tx);
    await assertDefaultAccount(tx, data.defaultAccountId);
    await tx
      .update(finContacts)
      .set({
        ...data,
        defaultAccountId: data.defaultAccountId ?? null,
        ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {}),
      })
      .where(eq(finContacts.id, id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "finance.contact_updated",
        targetType: "fin_contact",
        targetId: id,
        metadata: { from: before.displayName, to: data.displayName, isActive: input.isActive },
      },
      tx
    );
  });
}

/** Store (encrypted) a contact's SSN/EIN and the W-9 received date. Bookkeepers only. */
export async function setContactTaxInfo(
  ctx: SessionContext,
  id: string,
  input: { taxIdType: "ssn" | "ein"; taxId: string; w9ReceivedOn: string | null }
): Promise<void> {
  await requireFinance(ctx, "edit");
  if (!isEncryptionConfigured()) throw new DalError("INVALID", "Tax IDs can't be saved until FINANCE_ENCRYPTION_KEY is configured.");
  const { taxIdType, taxId } = taxIdInputSchema.parse(input);
  if (input.w9ReceivedOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.w9ReceivedOn)) throw new DalError("INVALID", "Enter a valid date.");
  await db.transaction(async (tx) => {
    await getContact(ctx, id, tx);
    await tx
      .update(finContacts)
      .set({ taxIdType, taxIdCiphertext: encryptSecret(taxId), taxIdLast4: taxId.slice(-4), w9ReceivedOn: input.w9ReceivedOn })
      .where(eq(finContacts.id, id));
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.contact_updated", targetType: "fin_contact", targetId: id, metadata: { taxInfo: "updated", taxIdType } },
      tx
    );
  });
}

/** Full tax id for 1099 filing. Finance admin only; audited. */
export async function revealTaxId(ctx: SessionContext, id: string): Promise<string | null> {
  await requireFinance(ctx, "admin");
  const [row] = await db.select({ c: finContacts.taxIdCiphertext }).from(finContacts).where(eq(finContacts.id, id)).limit(1);
  if (!row) throw new DalError("NOT_FOUND", "Contact not found.");
  if (!row.c) return null;
  await writeAudit({ actorUserId: ctx.userId, action: "finance.tax_id_viewed", targetType: "fin_contact", targetId: id });
  return decryptSecret(row.c);
}

/**
 * System helper (no authorization — callers authorize): the contact linked to an app
 * user, created on first use (reimbursement payee, donor who is a member). Adds the
 * requested role flag if missing.
 */
export async function ensureContactForUser(tx: DbOrTx, userId: string, role: ContactRole): Promise<string> {
  const flag = role === "vendor" ? { isVendor: true } : role === "customer" ? { isCustomer: true } : { isDonor: true };
  const [existing] = await tx.select({ id: finContacts.id }).from(finContacts).where(eq(finContacts.userId, userId)).limit(1);
  if (existing) {
    await tx.update(finContacts).set(flag).where(eq(finContacts.id, existing.id));
    return existing.id;
  }
  const [u] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new DalError("NOT_FOUND", "User not found.");
  const [row] = await tx
    .insert(finContacts)
    .values({ displayName: u.name?.trim() || u.email, kind: "individual", email: u.email, userId, createdByUserId: userId, ...flag })
    .onConflictDoNothing()
    .returning({ id: finContacts.id });
  if (row) return row.id;
  const [again] = await tx.select({ id: finContacts.id }).from(finContacts).where(eq(finContacts.userId, userId)).limit(1);
  return again.id;
}

/** Display names for ids (no tax data) — for list pages joining contacts. */
export async function contactNames(ids: string[], tx: DbOrTx = db): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: finContacts.id, name: finContacts.displayName })
    .from(finContacts)
    .where(sql`${finContacts.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
  return new Map(rows.map((r) => [r.id, r.name]));
}
