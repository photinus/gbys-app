"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import { createContact, revealTaxId, setContactTaxInfo, updateContact } from "@/lib/dal/finance-contacts";
import { removeW9, uploadW9 } from "@/lib/dal/finance-contact-docs";
import { DalError } from "@/lib/dal/context";

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};
const bool = (fd: FormData, key: string) => fd.get(key) === "on" || fd.get(key) === "true";

function refresh() {
  revalidatePath("/finance/contacts", "layout");
}

function contactFields(fd: FormData) {
  return {
    displayName: str(fd, "displayName"),
    kind: (str(fd, "kind") || "organization") as "individual" | "organization",
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    addressLine1: str(fd, "addressLine1"),
    addressLine2: str(fd, "addressLine2"),
    city: str(fd, "city"),
    state: str(fd, "state"),
    postalCode: str(fd, "postalCode"),
    isVendor: bool(fd, "isVendor"),
    isCustomer: bool(fd, "isCustomer"),
    isDonor: bool(fd, "isDonor"),
    is1099: bool(fd, "is1099"),
    defaultAccountId: str(fd, "defaultAccountId") || null,
    notes: str(fd, "notes"),
  };
}

export async function createContactAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction((ctx) => createContact(ctx, contactFields(fd)));
  if (res.ok) refresh();
  return res;
}

export async function updateContactAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction((ctx) => updateContact(ctx, str(fd, "contactId"), { ...contactFields(fd), isActive: bool(fd, "isActive") }));
  if (res.ok) refresh();
  return res;
}

export async function setTaxInfoAction(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction((ctx) =>
    setContactTaxInfo(ctx, str(fd, "contactId"), {
      taxIdType: (str(fd, "taxIdType") || "ssn") as "ssn" | "ein",
      taxId: str(fd, "taxId"),
      w9ReceivedOn: str(fd, "w9ReceivedOn") || null,
    })
  );
  if (res.ok) refresh();
  return res;
}

export async function uploadW9Action(_prev: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction(async (ctx) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DalError("INVALID", "Choose a file to upload.");
    await uploadW9(ctx, str(fd, "contactId"), file);
  });
  if (res.ok) refresh();
  return res;
}

export async function removeW9Action(contactId: string, attachmentId: string): Promise<ActionResult> {
  const res = await runAction((ctx) => removeW9(ctx, contactId, attachmentId));
  if (res.ok) refresh();
  return res;
}

/** Finance admins only (enforced in the DAL, which also writes the audit row). */
export async function revealTaxIdAction(contactId: string): Promise<ActionResult<{ taxId: string | null }>> {
  return runAction(async (ctx) => ({ taxId: await revealTaxId(ctx, contactId) }));
}
