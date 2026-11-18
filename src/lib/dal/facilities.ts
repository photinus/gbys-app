import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { resources, resourceBookings } from "@/db/schema";

/**
 * Checks whether a proposed booking conflicts with:
 * 1. The target resource itself
 * 2. The target resource's parent resource (e.g. booking Mat 1 when Whole Gym is booked)
 * 3. Any child resources of the target resource (e.g. booking Whole Gym when Mat 1 is booked)
 */
export async function checkResourceConflict({
  resourceId,
  startsAt,
  endsAt,
}: {
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
}) {
  const target = await db.query.resources.findFirst({
    where: eq(resources.id, resourceId),
  });

  if (!target) {
    throw new Error("Resource not found");
  }

  const children = await db.query.resources.findMany({
    where: eq(resources.parentResourceId, resourceId),
  });

  const relatedResourceIds = [
    resourceId,
    ...(target.parentResourceId ? [target.parentResourceId] : []),
    ...children.map((c) => c.id),
  ];

  const conflicts = await db.query.resourceBookings.findMany({
    where: and(
      inArray(resourceBookings.resourceId, relatedResourceIds),
      lt(resourceBookings.startsAt, endsAt),
      gt(resourceBookings.endsAt, startsAt)
    ),
  });

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
  };
}
