"use server";

import { runAction, type ActionResult } from "@/lib/dal/context";
import { listMyEmergencyContacts } from "@/lib/dal/emergency-contacts";
import type { EmergencyContact } from "@/db/schema/household";

/** Read-only: my household's saved emergency contacts (see listMyEmergencyContacts). */
export async function listSavedContactsAction(): Promise<ActionResult<EmergencyContact[]>> {
  return runAction((ctx) => listMyEmergencyContacts(ctx));
}
