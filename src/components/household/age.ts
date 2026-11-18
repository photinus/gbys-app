import { utcToLaDateInput } from "@/lib/format";

/** Whole years between a YYYY-MM-DD date of birth and today's Pacific date. No TZ conversion of the DOB. */
export function ageFromDob(dob: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const today = utcToLaDateInput(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - Number(m[1]);
  if (tm < Number(m[2]) || (tm === Number(m[2]) && td < Number(m[3]))) age -= 1;
  return age;
}
