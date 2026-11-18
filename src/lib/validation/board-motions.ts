import { z } from "zod";

// Client-safe: no server-only imports (used by forms, actions and the DAL).

export const MOTION_KINDS = ["in_meeting", "without_meeting"] as const;
export type MotionKind = (typeof MOTION_KINDS)[number];
export const MOTION_THRESHOLDS = ["majority_of_votes_cast", "two_thirds_of_votes_cast", "unanimous_of_directors"] as const;
export type MotionThreshold = (typeof MOTION_THRESHOLDS)[number];
export const MOTION_STATUSES = ["draft", "open", "passed", "failed", "withdrawn"] as const;
export type MotionStatus = (typeof MOTION_STATUSES)[number];
export const VOTE_CHOICES = ["yes", "no", "abstain"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export const KIND_LABELS: Record<MotionKind, string> = {
  in_meeting: "In a meeting",
  without_meeting: "Action without a meeting",
};
export const THRESHOLD_LABELS: Record<MotionThreshold, string> = {
  majority_of_votes_cast: "Majority of votes cast",
  two_thirds_of_votes_cast: "Two-thirds of votes cast",
  unanimous_of_directors: "Every eligible director votes yes",
};
export const THRESHOLD_EXPLAINERS: Record<MotionThreshold, string> = {
  majority_of_votes_cast: "Passes when more directors vote yes than no. Abstentions are not counted as votes cast, and a tie fails.",
  two_thirds_of_votes_cast: "Passes when yes votes are at least two-thirds of the yes and no votes. Abstentions are not counted as votes cast.",
  unanimous_of_directors:
    "Passes only if every eligible director votes yes. Any no or abstain vote, or a missing vote, means it fails.",
};
export const STATUS_LABELS: Record<MotionStatus, string> = {
  draft: "Draft",
  open: "Open for voting",
  passed: "Passed",
  failed: "Failed",
  withdrawn: "Withdrawn",
};
export const CHOICE_LABELS: Record<VoteChoice, string> = { yes: "Yes", no: "No", abstain: "Abstain" };

const uuid = z.string().uuid("Invalid identifier.");
const optionalUuid = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(uuid.nullable());

export const motionInputSchema = z
  .object({
    kind: z.enum(MOTION_KINDS, { message: "Choose how the motion will be voted on." }),
    meetingId: optionalUuid,
    title: z.string().trim().min(3, "Give the motion a title (at least 3 characters).").max(200, "The title is too long (max 200 characters)."),
    body: z.string().trim().min(3, "Enter the text of the motion.").max(10000, "The motion text is too long (max 10,000 characters)."),
    threshold: z.enum(MOTION_THRESHOLDS, { message: "Choose a threshold." }).default("majority_of_votes_cast"),
    movedBy: optionalUuid,
    secondedBy: optionalUuid,
  })
  .transform((v) => {
    // Action without a meeting always requires every eligible director to vote yes.
    if (v.kind === "without_meeting") return { ...v, meetingId: null, threshold: "unanimous_of_directors" as const };
    return v;
  })
  .superRefine((v, ctx) => {
    if (v.kind === "in_meeting" && !v.meetingId) {
      ctx.addIssue({ code: "custom", path: ["meetingId"], message: "Choose the meeting this motion belongs to." });
    }
  });
export type MotionInput = z.infer<typeof motionInputSchema>;
export type MotionInputRaw = z.input<typeof motionInputSchema>;

export const voteChoiceSchema = z.enum(VOTE_CHOICES, { message: "Choose Yes, No or Abstain." });

export const reasonSchema = z
  .string()
  .trim()
  .max(1000, "The note is too long (max 1,000 characters).")
  .nullish()
  .transform((v) => (v ? v : null));

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

export function motionInputFromForm(fd: FormData): MotionInputRaw {
  return {
    kind: str(fd, "kind") as MotionKind,
    meetingId: str(fd, "meetingId"),
    title: str(fd, "title"),
    body: str(fd, "body"),
    threshold: (str(fd, "threshold") || "majority_of_votes_cast") as MotionThreshold,
    movedBy: str(fd, "movedBy"),
    secondedBy: str(fd, "secondedBy"),
  };
}

/** Minimum notice for an action without a meeting. */
export const MIN_WRITTEN_CONSENT_HOURS = 24;
