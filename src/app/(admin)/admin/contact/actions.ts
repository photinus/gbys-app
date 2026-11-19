"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/dal/context";
import {
  createContactForm,
  deleteSubmission,
  getSubmission,
  listSubmissions,
  setSubmissionStatus,
  updateContactForm,
  type ContactScope,
  type SubmissionDetail,
  type SubmissionPage,
} from "@/lib/dal/contact-forms";
import {
  contactFormInputFromForm,
  type StatusFilter,
  type SubmissionStatus,
} from "@/lib/validation/contact-forms";

// Shared by /admin/contact and /programs/[slug]/contact. Authorization lives in the DAL.

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/admin/contact", "layout");
  revalidatePath("/programs", "layout");
}

export async function createContactFormAction(
  _prev: ActionResult<{ id: string }> | null,
  fd: FormData
): Promise<ActionResult<{ id: string }>> {
  const res = await runAction((ctx) => createContactForm(ctx, contactFormInputFromForm(fd)));
  if (res.ok) refresh();
  return res;
}

export async function updateContactFormAction(
  _prev: ActionResult<{ id: string }> | null,
  fd: FormData
): Promise<ActionResult<{ id: string }>> {
  const res = await runAction((ctx) => updateContactForm(ctx, str(fd, "id"), contactFormInputFromForm(fd)));
  if (res.ok) refresh();
  return res;
}

/** Opening a message marks it read. */
export async function openSubmissionAction(id: string): Promise<ActionResult<SubmissionDetail>> {
  const res = await runAction((ctx) => getSubmission(ctx, id));
  if (res.ok) refresh();
  return res;
}

export async function setSubmissionStatusAction(id: string, status: SubmissionStatus): Promise<ActionResult<{ status: SubmissionStatus }>> {
  const res = await runAction((ctx) => setSubmissionStatus(ctx, id, status));
  if (res.ok) refresh();
  return res;
}

export async function deleteSubmissionAction(id: string): Promise<ActionResult<void>> {
  const res = await runAction((ctx) => deleteSubmission(ctx, id));
  if (res.ok) refresh();
  return res;
}

export async function loadMoreSubmissionsAction(input: {
  scope: ContactScope;
  formId?: string;
  status?: StatusFilter;
  q?: string;
  cursor: string;
}): Promise<ActionResult<SubmissionPage>> {
  return runAction((ctx) => listSubmissions(ctx, input));
}
