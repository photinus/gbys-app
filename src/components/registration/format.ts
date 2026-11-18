import { formatCents, formatDate, formatDob } from "@/lib/format";

/** "Born Jan 1, 2015 - Dec 31, 2017" / "Born on or after ..." / null when unrestricted. */
export function eligibilityLabel(from: string | null, to: string | null): string | null {
  if (from && to) return `Born ${formatDob(from)} to ${formatDob(to)}`;
  if (from) return `Born on or after ${formatDob(from)}`;
  if (to) return `Born on or before ${formatDob(to)}`;
  return null;
}

export const feeLabel = (cents: number) => (cents === 0 ? "Free" : formatCents(cents));

export function seasonDatesLabel(startsOn: string | null, endsOn: string | null): string | null {
  if (startsOn && endsOn) return `${formatDob(startsOn)} to ${formatDob(endsOn)}`;
  if (startsOn) return `Starts ${formatDob(startsOn)}`;
  if (endsOn) return `Ends ${formatDob(endsOn)}`;
  return null;
}

export const closesLabel = (closesAt: Date | string | null) =>
  closesAt ? `Closes ${formatDate(closesAt)}` : "No closing date";
