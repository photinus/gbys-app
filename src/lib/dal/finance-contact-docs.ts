import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { finBills, finContacts, finGifts, finInvoices, finPayments } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { laToday } from "@/lib/finance/dates";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import {
  getAttachment,
  listAttachments,
  readAttachmentBytes,
  softDeleteAttachment,
  storeAttachment,
  type FinAttachmentRow,
} from "./finance-attachments";
import { getContact } from "./finance-contacts";

/**
 * W-9 documents and a cross-module activity summary for the contact page (Finance 2, PB).
 * W-9s hold tax ids, so every operation needs a bookkeeper (`edit`); downloads are audited.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function listW9s(ctx: SessionContext, contactId: string): Promise<FinAttachmentRow[]> {
  await requireFinance(ctx, "edit");
  await getContact(ctx, contactId);
  return listAttachments(db, "contact_w9", contactId);
}

/** Upload a W-9 (PDF or photo). Sets "W-9 received" to today when it was blank. */
export async function uploadW9(ctx: SessionContext, contactId: string, file: File): Promise<void> {
  await requireFinance(ctx, "edit");
  await db.transaction(async (tx) => {
    await getContact(ctx, contactId, tx);
    const { id } = await storeAttachment(tx, { ownerType: "contact_w9", ownerId: contactId, file, userId: ctx.userId });
    await tx
      .update(finContacts)
      .set({ w9ReceivedOn: sql`coalesce(${finContacts.w9ReceivedOn}, ${laToday()}::date)` })
      .where(eq(finContacts.id, contactId));
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.attachment_added", targetType: "fin_attachment", targetId: id, metadata: { contactId, kind: "w9" } },
      tx
    );
  });
}

export async function removeW9(ctx: SessionContext, contactId: string, attachmentId: string): Promise<void> {
  await requireFinance(ctx, "edit");
  await db.transaction(async (tx) => {
    const att = await getAttachment(attachmentId, tx);
    if (!att || att.ownerType !== "contact_w9" || att.ownerId !== contactId) throw new DalError("NOT_FOUND", "File not found.");
    await softDeleteAttachment(tx, attachmentId, ctx.userId);
    await writeAudit(
      { actorUserId: ctx.userId, action: "finance.attachment_removed", targetType: "fin_attachment", targetId: attachmentId, metadata: { contactId, kind: "w9" } },
      tx
    );
  });
}

/** Bytes for the authorized download route. Audited because a W-9 shows the tax id. */
export async function readW9(ctx: SessionContext, attachmentId: string): Promise<{ fileName: string; contentType: string; body: Buffer }> {
  await requireFinance(ctx, "edit");
  const att = await getAttachment(attachmentId);
  if (!att || att.ownerType !== "contact_w9") throw new DalError("NOT_FOUND", "File not found.");
  const obj = await readAttachmentBytes(att.objectKey);
  if (!obj) throw new DalError("NOT_FOUND", "File not found.");
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.tax_id_viewed",
    targetType: "fin_contact",
    targetId: att.ownerId,
    metadata: { via: "w9_download", attachmentId },
  });
  return { fileName: att.fileName, contentType: att.contentType, body: obj.body };
}

export interface ContactActivity {
  bills: { count: number; openCents: number };
  paidOutCents: number;
  invoices: { count: number; openCents: number };
  gifts: { count: number; totalCents: number };
}

/** Counts across payables, receivables and donations for the contact page. */
export async function getContactActivity(ctx: SessionContext, contactId: string): Promise<ContactActivity> {
  await requireFinance(ctx, "view_all");
  if (!UUID_RE.test(contactId)) throw new DalError("NOT_FOUND", "Contact not found.");
  const [b] = await db
    .select({
      n: sql<number>`count(*)::int`,
      open: sql<number>`coalesce(sum(case when ${finBills.status} in ('approved','partially_paid') then ${finBills.totalCents} - ${finBills.paidCents} else 0 end), 0)::int`,
    })
    .from(finBills)
    .where(and(eq(finBills.contactId, contactId), sql`${finBills.status} <> 'void'`));
  const [p] = await db
    .select({ s: sql<number>`coalesce(sum(${finPayments.amountCents}), 0)::int` })
    .from(finPayments)
    .where(and(eq(finPayments.contactId, contactId), eq(finPayments.direction, "out"), sql`${finPayments.voidedAt} is null`));
  const [i] = await db
    .select({
      n: sql<number>`count(*)::int`,
      open: sql<number>`coalesce(sum(case when ${finInvoices.status} in ('open','partially_paid') then ${finInvoices.totalCents} - ${finInvoices.paidCents} else 0 end), 0)::int`,
    })
    .from(finInvoices)
    .where(and(eq(finInvoices.contactId, contactId), sql`${finInvoices.status} <> 'void'`));
  const [g] = await db
    .select({ n: sql<number>`count(*)::int`, s: sql<number>`coalesce(sum(${finGifts.amountCents}), 0)::int` })
    .from(finGifts)
    .where(and(eq(finGifts.donorContactId, contactId), sql`${finGifts.voidedAt} is null`));
  return {
    bills: { count: b.n, openCents: b.open },
    paidOutCents: p.s,
    invoices: { count: i.n, openCents: i.open },
    gifts: { count: g.n, totalCents: g.s },
  };
}
