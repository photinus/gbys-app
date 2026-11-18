import { z } from "zod";
import { laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import { VERIFICATION_METHODS, VOLUNTEER_CATEGORIES } from "@/lib/volunteer-categories";

/** Real calendar date check (rejects 2026-02-30, which Date.UTC would roll over). */
function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const ymd = z.string().refine(isRealDate, "Enter a valid date.");

export const VERIFICATION_FILTERS = ["verified", "all", ...VERIFICATION_METHODS] as const;
export type VerificationFilter = (typeof VERIFICATION_FILTERS)[number];

export const grantFiltersSchema = z
  .object({
    from: ymd,
    to: ymd,
    program: z.union([z.literal("all"), z.literal("org"), z.string().uuid("Invalid program.")]),
    categories: z.array(z.enum(VOLUNTEER_CATEGORIES)),
    verification: z.enum(VERIFICATION_FILTERS),
  })
  .refine((v) => v.from <= v.to, { message: "The start date must be on or before the end date.", path: ["from"] });

export type GrantFilters = z.infer<typeof grantFiltersSchema>;

export function defaultGrantFilters(now = new Date()): GrantFilters {
  const today = utcToLaDateInput(now);
  return {
    from: `${today.slice(0, 4)}-01-01`,
    to: today,
    program: "all",
    categories: [],
    verification: "verified",
  };
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function all(params: Params, key: string): string[] {
  const raw = params instanceof URLSearchParams ? params.getAll(key) : params[key];
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list.map((v) => v.trim()).filter((v) => v !== "");
}

export type ParsedGrantFilters =
  | { ok: true; filters: GrantFilters }
  | { ok: false; error: string; filters: GrantFilters };

/** Parse the GET-form / URL search params. On error, `filters` holds the defaults. */
export function parseGrantFilters(params: Params): ParsedGrantFilters {
  const d = defaultGrantFilters();
  const candidate = {
    from: all(params, "from")[0] ?? d.from,
    to: all(params, "to")[0] ?? d.to,
    program: all(params, "program")[0] ?? d.program,
    categories: [...new Set(all(params, "categories"))],
    verification: all(params, "verification")[0] ?? d.verification,
  };
  const res = grantFiltersSchema.safeParse(candidate);
  if (res.success) return { ok: true, filters: res.data };
  return { ok: false, error: res.error.issues[0]?.message ?? "Invalid filters.", filters: d };
}

/** Inverse of parseGrantFilters: carries the same params to the export / print links. */
export function grantFiltersToQuery(f: GrantFilters): string {
  const q = new URLSearchParams();
  q.set("from", f.from);
  q.set("to", f.to);
  q.set("program", f.program);
  q.set("verification", f.verification);
  for (const c of f.categories) q.append("categories", c);
  return q.toString();
}

/** Inclusive LA-calendar-day bounds as UTC instants. */
export function grantDateBounds(f: Pick<GrantFilters, "from" | "to">): { start: Date; end: Date } {
  return { start: laDateInputToUtc(f.from, false), end: laDateInputToUtc(f.to, true) };
}
