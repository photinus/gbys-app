"use server";

import type { ActionResult } from "@/lib/dal/context";
import { approveImpl, approveSeriesImpl, cancelImpl, declineImpl, directBookingImpl } from "@/components/facilities/action-impl";

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
