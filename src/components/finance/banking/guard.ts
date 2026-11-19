import { notFound } from "next/navigation";
import { DalError } from "@/lib/dal/context";

/** Run a DAL read for a page; FORBIDDEN / NOT_FOUND become a 404. */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DalError && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND")) notFound();
    throw e;
  }
}
