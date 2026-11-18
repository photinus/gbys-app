import type { ActionResult } from "@/lib/dal/context";

export type FormAction = (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;

export interface MotionActions {
  create: FormAction;
  update: FormAction;
  open: FormAction;
  close: (id: string) => Promise<ActionResult<{ passed: boolean; reason: string }>>;
  withdraw: (id: string, reason?: string) => Promise<ActionResult>;
  rollCall: (motionId: string, boardMemberId: string, choice: string) => Promise<ActionResult>;
}
