"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  acceptGuardianInvite,
  createAthlete,
  createGuardianInvite,
  getAthleteDetail,
  removeGuardian,
  revokeInvite,
  updateAthlete,
  updateMyProfile,
  type AthleteDetail,
} from "@/lib/dal/households";
import { athleteSchema, inviteSchema, profileSchema } from "@/lib/validation/household";

// Inputs are validated with zod here (and again, defensively, inside the DAL).
// Authorization is enforced by the DAL itself.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on";

function athleteFromForm(fd: FormData) {
  const names = fd.getAll("ec_name").map(String);
  const phones = fd.getAll("ec_phone").map(String);
  const rels = fd.getAll("ec_relationship").map(String);
  return {
    firstName: str(fd, "firstName"),
    lastName: str(fd, "lastName"),
    dateOfBirth: str(fd, "dateOfBirth"),
    gender: str(fd, "gender"),
    gradeLevel: str(fd, "gradeLevel"),
    medicalNotes: str(fd, "medicalNotes"),
    relationship: str(fd, "relationship"),
    emergencyContacts: names.map((name, i) => ({
      name,
      phone: phones[i] ?? "",
      relationship: rels[i] ?? "",
    })),
  };
}

export async function updateProfileAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    const input = profileSchema.parse({
      name: str(formData, "name"),
      phone: str(formData, "phone"),
      smsOptIn: bool(formData, "smsOptIn"),
    });
    await updateMyProfile(ctx, input);
  });
  if (res.ok) revalidatePath("/household");
  return res;
}

export async function createAthleteAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const res = await runAction((ctx) =>
    createAthlete(ctx, athleteSchema.parse(athleteFromForm(formData)))
  );
  if (res.ok) revalidatePath("/household");
  return res;
}

export async function updateAthleteAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const athleteId = str(formData, "athleteId");
  const res = await runAction((ctx) =>
    updateAthlete(ctx, athleteId, athleteSchema.parse(athleteFromForm(formData)))
  );
  if (res.ok) revalidatePath("/household");
  return res;
}

/** Audited read (writes medical.viewed). Called from a click handler, never an effect. */
export async function fetchAthleteDetailAction(athleteId: string): Promise<ActionResult<AthleteDetail>> {
  return runAction((ctx) => getAthleteDetail(ctx, String(athleteId)));
}

export async function createInviteAction(
  _prev: ActionResult<{ emailSent: boolean }> | null,
  formData: FormData
): Promise<ActionResult<{ emailSent: boolean }>> {
  const res = await runAction(async (ctx) => {
    const input = inviteSchema.parse({
      email: str(formData, "email"),
      relationship: str(formData, "relationship"),
      athleteIds: formData.getAll("athleteId").map(String),
      canRegister: bool(formData, "canRegister"),
      canSignWaivers: bool(formData, "canSignWaivers"),
      receivesComms: bool(formData, "receivesComms"),
    });
    const { emailSent } = await createGuardianInvite(ctx, input);
    return { emailSent };
  });
  if (res.ok) revalidatePath("/household");
  return res;
}

export async function revokeInviteAction(inviteId: string): Promise<ActionResult> {
  const res = await runAction((ctx) => revokeInvite(ctx, String(inviteId)));
  if (res.ok) revalidatePath("/household");
  return res;
}

export async function removeGuardianAction(athleteId: string, userId: string): Promise<ActionResult> {
  const res = await runAction((ctx) => removeGuardian(ctx, String(athleteId), String(userId)));
  if (res.ok) revalidatePath("/household");
  return res;
}

export async function acceptInviteAction(token: string): Promise<ActionResult<{ athleteCount: number }>> {
  const res = await runAction((ctx) => acceptGuardianInvite(ctx, String(token)));
  if (res.ok) {
    revalidatePath("/household");
    revalidatePath("/dashboard");
  }
  return res;
}
