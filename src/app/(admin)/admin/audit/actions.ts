"use server";

import { DalError, runAction, type ActionResult } from "@/lib/dal/context";
import { listAuditLog, type AuditLogPage } from "@/lib/dal/audit-log";
import { parseAuditFilters } from "@/lib/validation/audit-log";

/**
 * "Load more": the next page for the same filters. Cursor pages never write an `audit.viewed` row
 * (listAuditLog skips it when a cursor is set). Board-only is enforced inside the DAL.
 */
export async function loadMoreAuditAction(query: string, cursor: string): Promise<ActionResult<AuditLogPage>> {
  return runAction(async (ctx) => {
    const parsed = parseAuditFilters(new URLSearchParams(query));
    if (!parsed.ok) throw new DalError("INVALID", parsed.error);
    return listAuditLog(ctx, { ...parsed.filters, cursor });
  });
}
