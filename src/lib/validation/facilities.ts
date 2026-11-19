import { z } from "zod";
import { laDateTimeInputToUtc, utcToLaDateTimeInput } from "@/lib/format";

/** Pure helpers + schemas for facilities (importable by client components). */

export const RESOURCE_KINDS = ["complex", "field", "gym", "court", "cage", "mat", "room", "other"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  complex: "Complex",
  field: "Field",
  gym: "Gym",
  court: "Court",
  cage: "Batting cage",
  mat: "Mat",
  room: "Room",
  other: "Other",
};

export const BOOKING_STATUSES = ["requested", "approved", "declined", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const MAX_BOOKING_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_CALENDAR_DAYS = 62;

export const uuidSchema = z.string().uuid("Invalid identifier.");

const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** datetime-local string (Pacific wall clock) or Date -> UTC Date, or null when invalid. */
function parseWhen(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const v = value.trim();
  if (!LOCAL_DT.test(v)) return null;
  const d = laDateTimeInputToUtc(v);
  if (Number.isNaN(d.getTime())) return null;
  return utcToLaDateTimeInput(d) === v ? d : null; // rejects Feb 31 / nonexistent DST hour
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (${max} max).`)
    .transform((v) => v || null)
    .nullish()
    .transform((v) => v ?? null);

const nullableUuid = (msg: string) =>
  z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.string().uuid(msg).nullable());

export const facilitySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80, "Name is too long (80 max)."),
  kind: z.enum(RESOURCE_KINDS, { error: "Choose a kind." }),
  parentId: nullableUuid("Choose a valid parent."),
  locationAddress: optionalText(200, "Address"),
  notes: optionalText(500, "Notes"),
});
export type FacilityInput = z.output<typeof facilitySchema>;
export type FacilityFormInput = z.input<typeof facilitySchema>;

export const directBookingSchema = z
  .object({
    resourceId: z.string().uuid("Choose a facility."),
    programId: nullableUuid("Choose a valid program."),
    title: z.string().trim().min(1, "Title is required.").max(120, "Title is too long (120 max)."),
    startsAt: z.union([z.string(), z.date()]),
    endsAt: z.union([z.string(), z.date()]),
    notes: optionalText(500, "Notes"),
  })
  .transform((v, ctx) => {
    const startsAt = parseWhen(v.startsAt);
    const endsAt = parseWhen(v.endsAt);
    if (!startsAt) ctx.addIssue({ code: "custom", path: ["startsAt"], message: "Enter a valid start time." });
    if (!endsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Enter a valid end time." });
    if (!startsAt || !endsAt) return z.NEVER;
    if (endsAt <= startsAt) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End time must be after the start time." });
      return z.NEVER;
    }
    if (endsAt.getTime() - startsAt.getTime() > MAX_BOOKING_MS) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "A booking can be at most 7 days long." });
      return z.NEVER;
    }
    return { ...v, startsAt, endsAt };
  });
export type DirectBookingFormInput = z.input<typeof directBookingSchema>;
export type DirectBookingInput = z.output<typeof directBookingSchema>;

export const reasonSchema = z
  .string()
  .trim()
  .min(3, "Enter a reason (at least 3 characters).")
  .max(500, "Reason is too long (500 max).");

export const noteSchema = z
  .string()
  .trim()
  .max(500, "Note is too long (500 max).")
  .transform((v) => v || null)
  .nullish()
  .transform((v) => v ?? null);

/** Flat facility row as shown in pickers / the tree editor. */
export interface FacilityRow {
  id: string;
  parentResourceId: string | null;
  name: string;
  kind: ResourceKind;
  locationAddress: string | null;
  notes: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface FacilityNode extends FacilityRow {
  depth: number;
  children: FacilityNode[];
}

/** Build the tree (roots first, siblings by sortOrder then name). Orphans become roots. */
export function buildFacilityTree(rows: FacilityRow[]): FacilityNode[] {
  const byId = new Map<string, FacilityNode>();
  for (const r of rows) byId.set(r.id, { ...r, depth: 0, children: [] });
  const roots: FacilityNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentResourceId ? byId.get(n.parentResourceId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (list: FacilityNode[], depth: number) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const n of list) {
      n.depth = depth;
      sort(n.children, depth + 1);
    }
  };
  sort(roots, 0);
  return roots;
}

/** Depth-first flatten (parents before children). */
export function flattenFacilityTree(roots: FacilityNode[]): FacilityNode[] {
  const out: FacilityNode[] = [];
  const walk = (list: FacilityNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** Ids of a node and all its descendants. */
export function subtreeIds(roots: FacilityNode[], id: string): Set<string> {
  const ids = new Set<string>();
  const find = (list: FacilityNode[]): FacilityNode | null => {
    for (const n of list) {
      if (n.id === id) return n;
      const f = find(n.children);
      if (f) return f;
    }
    return null;
  };
  const start = find(roots);
  const walk = (n: FacilityNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  if (start) walk(start);
  return ids;
}
