import "server-only";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  approveBooking,
  approveSeries,
  cancelBooking,
  createDirectBooking,
  createFacility,
  deactivateFacility,
  declineBooking,
  reactivateFacility,
  updateFacility,
  type SeriesApprovalResult,
} from "@/lib/dal/facilities";

// Shared implementations for the board (/admin/facilities) and program
// (/programs/[slug]/schedule) action files. Authorization lives in the DAL.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/admin/facilities");
  revalidatePath("/programs/[slug]/schedule", "page");
}

async function done<T>(res: ActionResult<T>): Promise<ActionResult<T>> {
  if (res.ok) refresh();
  return res;
}

const facilityFields = (fd: FormData) => ({
  name: str(fd, "name"),
  kind: str(fd, "kind") as never,
  parentId: str(fd, "parentId"),
  locationAddress: str(fd, "locationAddress"),
  notes: str(fd, "notes"),
});

export async function saveFacilityImpl(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const id = str(fd, "id");
  return done(
    await runAction(async (ctx) => {
      if (id) {
        await updateFacility(ctx, id, { ...facilityFields(fd), sortOrder: str(fd, "sortOrder") === "" ? undefined : Number(str(fd, "sortOrder")) });
        return { id };
      }
      return createFacility(ctx, facilityFields(fd));
    })
  );
}

export async function deactivateFacilityImpl(id: string): Promise<ActionResult<{ deactivated: number }>> {
  return done(await runAction((ctx) => deactivateFacility(ctx, id)));
}

export async function reactivateFacilityImpl(id: string): Promise<ActionResult> {
  return done(await runAction((ctx) => reactivateFacility(ctx, id)));
}

export async function directBookingImpl(fd: FormData): Promise<ActionResult<{ id: string }>> {
  return done(
    await runAction((ctx) =>
      createDirectBooking(ctx, {
        resourceId: str(fd, "resourceId"),
        programId: str(fd, "programId"),
        title: str(fd, "title"),
        startsAt: str(fd, "startsAt"),
        endsAt: str(fd, "endsAt"),
        notes: str(fd, "notes"),
      })
    )
  );
}

export async function approveImpl(id: string, note?: string): Promise<ActionResult> {
  return done(await runAction((ctx) => approveBooking(ctx, id, note ?? null)));
}

export interface SeriesApprovalView {
  approved: number;
  conflicted: { id: string; title: string; startsAt: string; endsAt: string; conflictsWith: string[] }[];
  skipped: { id: string; startsAt: string; reason: string }[];
}

export async function approveSeriesImpl(seriesId: string): Promise<ActionResult<SeriesApprovalView>> {
  return done(
    await runAction(async (ctx) => {
      const r: SeriesApprovalResult = await approveSeries(ctx, seriesId);
      return {
        approved: r.approved,
        conflicted: r.conflicted.map((c) => ({
          id: c.id,
          title: c.title,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
          conflictsWith: c.conflictsWith.map((x) => `${x.title} (${x.resourceName})`),
        })),
        skipped: r.skipped.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), reason: s.reason })),
      };
    })
  );
}

export async function declineImpl(fd: FormData): Promise<ActionResult> {
  return done(await runAction((ctx) => declineBooking(ctx, str(fd, "id"), str(fd, "reason"))));
}

export async function cancelImpl(fd: FormData): Promise<ActionResult> {
  return done(await runAction((ctx) => cancelBooking(ctx, str(fd, "id"), str(fd, "reason"))));
}
