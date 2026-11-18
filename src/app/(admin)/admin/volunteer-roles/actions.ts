"use server";

import type { ActionResult } from "@/lib/dal/context";
import {
  approveImpl,
  archiveRoleImpl,
  assignImpl,
  createRoleImpl,
  declineImpl,
  endImpl,
  restoreRoleImpl,
  updateRoleImpl,
} from "@/components/volunteer-roles/action-impl";

export async function createRoleAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  return createRoleImpl(fd, true);
}
export async function updateRoleAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  return updateRoleImpl(fd);
}
export async function archiveRoleAction(id: string) {
  return archiveRoleImpl(id);
}
export async function restoreRoleAction(id: string) {
  return restoreRoleImpl(id);
}
export async function approveAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  return approveImpl(fd);
}
export async function declineAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  return declineImpl(fd);
}
export async function endAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  return endImpl(fd);
}
export async function assignAction(_prev: ActionResult<unknown> | null, fd: FormData) {
  return assignImpl(fd);
}
