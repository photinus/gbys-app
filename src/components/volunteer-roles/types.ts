import type { ActionResult } from "@/lib/dal/context";

type FormAction<T = unknown> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/** Server actions handed down from each page (program page vs admin page revalidate different paths). */
export interface RoleActions {
  create: FormAction<{ id: string }>;
  update: FormAction;
  archive: (id: string) => Promise<ActionResult>;
  restore: (id: string) => Promise<ActionResult>;
  approve: FormAction<{ missingCredentials: string[]; grantedAccess: boolean }>;
  decline: FormAction;
  end: FormAction<{ revokedAccess: boolean }>;
  assign: FormAction<{ id: string; missingCredentials: string[] }>;
}
