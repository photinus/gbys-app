import { z } from "zod";
import { laDateInputToUtc } from "@/lib/format";

// Client-safe (no server-only imports): used by the filter form, the page, actions and the DAL.

export const AUDIT_PAGE_SIZE = 100;

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** "" / undefined -> undefined, otherwise the trimmed string. */
const optText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((v) => (v ? v : undefined));

const optDate = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || isRealDate(v), `${label} must be a valid date.`);

// Actions look like "credential.verified"; target types like "user_credential".
const identifier = (label: string) =>
  optText(64, `${label} is too long.`).refine(
    (v) => v === undefined || /^[a-z0-9_.:-]+$/i.test(v),
    `${label} contains invalid characters.`,
  );

export const auditFiltersSchema = z
  .object({
    action: identifier("Action"),
    actorQuery: optText(100, "Actor search is too long (max 100 characters)."),
    targetType: identifier("Target type"),
    targetId: optText(100, "Target id is too long."),
    from: optDate("From"),
    to: optDate("To"),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "The start date must be on or before the end date.",
    path: ["from"],
  });

export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/**
 * Cursor = full-precision UTC timestamp of the last row on the page (Postgres keeps microseconds,
 * JS Dates do not) plus its id, so keyset paging stays exact across identical timestamps.
 */
export const auditCursorSchema = z
  .string()
  .max(80)
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid cursor.",
  );

export function parseAuditCursor(cursor: string): { ts: string; id: string } {
  const c = auditCursorSchema.parse(cursor);
  const [ts, id] = c.split("|");
  return { ts, id: id.toLowerCase() };
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function first(params: Params, key: string): string | undefined {
  const raw = params instanceof URLSearchParams ? params.get(key) : params[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === null || v === undefined ? undefined : v;
}

export type ParsedAuditFilters =
  | { ok: true; filters: AuditFilters }
  | { ok: false; error: string; filters: AuditFilters };

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  action: undefined,
  actorQuery: undefined,
  targetType: undefined,
  targetId: undefined,
  from: undefined,
  to: undefined,
};

/** Parse GET params. On error `filters` is empty (no filtering) and `error` explains why. */
export function parseAuditFilters(params: Params): ParsedAuditFilters {
  const res = auditFiltersSchema.safeParse({
    action: first(params, "action"),
    actorQuery: first(params, "actor"),
    targetType: first(params, "targetType"),
    targetId: first(params, "targetId"),
    from: first(params, "from"),
    to: first(params, "to"),
  });
  if (res.success) return { ok: true, filters: res.data };
  return { ok: false, error: res.error.issues[0]?.message ?? "Invalid filters.", filters: EMPTY_AUDIT_FILTERS };
}

/** Inverse of parseAuditFilters (only the set fields). */
export function auditFiltersToQuery(f: AuditFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.action) q.set("action", f.action);
  if (f.actorQuery) q.set("actor", f.actorQuery);
  if (f.targetType) q.set("targetType", f.targetType);
  if (f.targetId) q.set("targetId", f.targetId);
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  return q;
}

/** Inclusive LA-calendar-day range as [start, endExclusive) UTC instants. */
export function auditDateBounds(f: Pick<AuditFilters, "from" | "to">): { start?: Date; endExclusive?: Date } {
  let endExclusive: Date | undefined;
  if (f.to) {
    const [y, m, d] = f.to.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    endExclusive = laDateInputToUtc(next, false);
  }
  return { start: f.from ? laDateInputToUtc(f.from, false) : undefined, endExclusive };
}
