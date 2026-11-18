import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { athletes, householdGuardians } from "@/db/schema";
import type { EmergencyContact } from "@/db/schema/household";
import { normalizePhone } from "@/lib/validation/household";
import type { SessionContext } from "./context";

/**
 * Distinct emergency contacts saved on any athlete where I am a guardian,
 * for the "Use a saved contact" picker. Deduped on normalized phone + name.
 *
 * Deliberately NOT audited: it returns only contact cards from my own
 * household (name, phone, relationship) and never medical notes.
 */
export async function listMyEmergencyContacts(ctx: SessionContext): Promise<EmergencyContact[]> {
  const rows = await db
    .select({ contacts: athletes.emergencyContacts })
    .from(householdGuardians)
    .innerJoin(athletes, eq(athletes.id, householdGuardians.athleteId))
    .where(and(eq(householdGuardians.userId, ctx.userId), isNull(athletes.deletedAt)))
    .orderBy(desc(athletes.updatedAt), desc(athletes.createdAt));

  const seen = new Set<string>();
  const out: EmergencyContact[] = [];
  for (const row of rows) {
    for (const c of row.contacts ?? []) {
      const name = String(c?.name ?? "").trim();
      const phone = String(c?.phone ?? "").trim();
      const relationship = String(c?.relationship ?? "").trim();
      if (!name || !phone) continue;
      const key = `${normalizePhone(phone) ?? phone.replace(/\D/g, "")}|${name.toLowerCase().replace(/\s+/g, " ")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, phone, relationship });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
