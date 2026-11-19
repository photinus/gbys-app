import { notFound } from "next/navigation";
import { DalError } from "@/lib/dal/context";
import type { ReportQuery } from "@/lib/dal/finance-reports";

/** Await a report DAL call; FORBIDDEN / NOT_FOUND become a 404 page. */
export async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof DalError && (e.code === "FORBIDDEN" || e.code === "NOT_FOUND")) notFound();
    throw e;
  }
}

type RawParams = Record<string, string | string[] | undefined>;

/** First value of each known report query param. */
export function toReportQuery(sp: RawParams): ReportQuery {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  return {
    from: one("from"),
    to: one("to"),
    asOf: one("asOf"),
    program: one("program"),
    fund: one("fund"),
    account: one("account"),
  };
}
