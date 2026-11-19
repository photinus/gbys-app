import "server-only";
import { notFound } from "next/navigation";
import { DalError } from "@/lib/dal/context";

/** Run a page's DAL calls; FORBIDDEN / NOT_FOUND become a 404 (we don't reveal what exists). */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DalError && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND")) notFound();
    throw e;
  }
}
