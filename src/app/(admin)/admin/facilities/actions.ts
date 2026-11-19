"use server";

import type { ActionResult } from "@/lib/dal/context";
import {
  approveImpl,
  approveSeriesImpl,
  cancelImpl,
  deactivateFacilityImpl,
  declineImpl,
  directBookingImpl,
  reactivateFacilityImpl,
  saveFacilityImpl,
} from "@/components/facilities/action-impl";

export async function saveFacilityAction(_prev: ActionResult<{ id: string }> | null, fd: FormData) {
  return saveFacilityImpl(fd);
}
export async function deactivateFacilityAction(id: string) {
  return deactivateFacilityImpl(id);
}
export async function reactivateFacilityAction(id: string) {
  return reactivateFacilityImpl(id);
}
export async function directBookingAction(_prev: ActionResult<{ id: string }> | null, fd: FormData) {
  return directBookingImpl(fd);
}
export async function approveBookingAction(id: string) {
  return approveImpl(id);
}
export async function approveSeriesAction(seriesId: string) {
  return approveSeriesImpl(seriesId);
}
export async function declineBookingAction(_prev: ActionResult | null, fd: FormData) {
  return declineImpl(fd);
}
export async function cancelBookingAction(_prev: ActionResult | null, fd: FormData) {
  return cancelImpl(fd);
}
