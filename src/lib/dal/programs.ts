import "server-only";
import { asc, eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { programs } from "@/db/schema";
import type { SessionContext } from "./context";

export interface ProgramOption {
  id: string;
  name: string;
  slug: string;
  sport: string;
}

/**
 * Active programs for dropdowns/filters. Non-sensitive: any signed-in user.
 * (Shared contract for Sprint 2 workers. W-Programs extends this file.)
 */
export async function listActivePrograms(ctx: SessionContext): Promise<ProgramOption[]> {
  void ctx;
  return db
    .select({ id: programs.id, name: programs.name, slug: programs.slug, sport: programs.sport })
    .from(programs)
    .where(and(eq(programs.isActive, true), isNull(programs.deletedAt)))
    .orderBy(asc(programs.name));
}
