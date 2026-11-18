// Display labels shared by shifts, hours ledger and grant reports (client-safe).
export const VOLUNTEER_CATEGORIES = [
  "coaching",
  "event_ops",
  "admin_board",
  "facility_maintenance",
  "concessions",
  "other",
] as const;
export type VolunteerCategory = (typeof VOLUNTEER_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<VolunteerCategory, string> = {
  coaching: "Coaching",
  event_ops: "Event operations",
  admin_board: "Admin & board",
  facility_maintenance: "Facility maintenance",
  concessions: "Concessions",
  other: "Other",
};

export const VERIFICATION_METHODS = ["self_reported", "shift_checkin", "admin_approved"] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const VERIFICATION_LABELS: Record<VerificationMethod, string> = {
  self_reported: "Self-reported (pending)",
  shift_checkin: "Shift check-in",
  admin_approved: "Admin approved",
};
