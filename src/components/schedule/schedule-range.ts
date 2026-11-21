/** How far ahead the family schedule looks (?range=). Default: next 4 weeks. */
export const SCHEDULE_RANGES = [
  { key: "4w", label: "4 weeks", title: "Next 4 weeks", days: 28 },
  { key: "3m", label: "3 months", title: "Next 3 months", days: 91 },
  { key: "6m", label: "6 months", title: "Next 6 months", days: 183 },
  { key: "12m", label: "12 months", title: "Next 12 months", days: 366 },
] as const;

export type ScheduleRangeKey = (typeof SCHEDULE_RANGES)[number]["key"];

export function parseScheduleRange(raw: string | string[] | undefined) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SCHEDULE_RANGES.find((r) => r.key === v) ?? SCHEDULE_RANGES[0];
}
