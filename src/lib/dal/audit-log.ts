import "server-only";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import {
  AUDIT_PAGE_SIZE,
  auditDateBounds,
  auditFiltersSchema,
  parseAuditCursor,
  type AuditFilters,
} from "@/lib/validation/audit-log";
import { DalError, isBoard, type SessionContext } from "./context";

function requireBoard(ctx: SessionContext) {
  if (!isBoard(ctx)) throw new DalError("FORBIDDEN", "You do not have permission to do that.");
}

export interface AuditLogRow {
  id: string;
  /** ISO instant (ms precision, for display). */
  createdAt: string;
  actorUserId: string | null;
  /** "System" when there is no actor (cron, webhooks). */
  actorName: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: unknown;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  /** Opaque cursor for the next (older) page, or null when this was the last page. */
  nextCursor: string | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function buildWhere(f: AuditFilters, cursor?: string): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (f.action) conds.push(eq(auditLogs.action, f.action));
  if (f.targetType) conds.push(eq(auditLogs.targetType, f.targetType));
  if (f.targetId) conds.push(eq(auditLogs.targetId, f.targetId));
  if (f.actorQuery) {
    if (f.actorQuery.toLowerCase() === "system") {
      conds.push(isNull(auditLogs.actorUserId));
    } else {
      const pat = `%${escapeLike(f.actorQuery)}%`;
      conds.push(and(isNotNull(auditLogs.actorUserId), or(ilike(users.name, pat), ilike(users.email, pat))));
    }
  }
  const { start, endExclusive } = auditDateBounds(f);
  if (start) conds.push(gte(auditLogs.createdAt, start));
  if (endExclusive) conds.push(lt(auditLogs.createdAt, endExclusive));
  if (cursor) {
    const c = parseAuditCursor(cursor);
    conds.push(sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${c.ts + "Z"}::timestamptz, ${c.id}::uuid)`);
  }
  return conds.length ? and(...conds) : undefined;
}

/**
 * Board-only audit log viewer. Newest first, keyset-paginated on (created_at desc, id desc), 100 per page.
 * Date filters are inclusive Pacific-time calendar days. A first-page load (no cursor) records ONE
 * `audit.viewed` row with the filters; cursor pages ("load more") never write.
 */
export async function listAuditLog(
  ctx: SessionContext,
  input: Partial<AuditFilters> & { cursor?: string | null } = {},
): Promise<AuditLogPage> {
  requireBoard(ctx);
  const { cursor, ...rawFilters } = input;
  const filters = auditFiltersSchema.parse(rawFilters);
  const where = buildWhere(filters, cursor || undefined);

  const rows = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      // Full precision (µs) for the cursor; JS Dates only carry milliseconds.
      cursorTs: sql<string>`to_char(${auditLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
      actorUserId: auditLogs.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(AUDIT_PAGE_SIZE + 1);

  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;
  const last = page[page.length - 1];

  if (!cursor) {
    const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
    await writeAudit({
      actorUserId: ctx.userId,
      action: "audit.viewed",
      targetType: "audit_log",
      targetId: "audit_log",
      metadata: { filters: f },
    });
  }

  return {
    rows: page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actorUserId: r.actorUserId,
      actorName: r.actorUserId ? (r.actorName ?? "Unknown user") : "System",
      actorEmail: r.actorEmail,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
    })),
    nextCursor: hasMore && last ? `${last.cursorTs}|${last.id}` : null,
  };
}

/** Board-only: distinct actions and target types present in the log, for the filter selects. */
export async function listAuditFilterOptions(
  ctx: SessionContext,
): Promise<{ actions: string[]; targetTypes: string[] }> {
  requireBoard(ctx);
  const [actions, targetTypes] = await Promise.all([
    db.selectDistinct({ v: auditLogs.action }).from(auditLogs).orderBy(asc(auditLogs.action)),
    db.selectDistinct({ v: auditLogs.targetType }).from(auditLogs).orderBy(asc(auditLogs.targetType)),
  ]);
  return { actions: actions.map((r) => r.v), targetTypes: targetTypes.map((r) => r.v) };
}
