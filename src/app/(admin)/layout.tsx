import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { DalError, requireOrgRole } from "@/lib/dal/context";
import { buildShellUser } from "@/lib/dal/shell-user";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireOrgRole("super_admin", "board_member");
  } catch (err) {
    // Hide the existence of admin pages from non-board users.
    if (err instanceof DalError && err.code === "FORBIDDEN") notFound();
    throw err;
  }
  return <AppShell user={await buildShellUser(ctx)}>{children}</AppShell>;
}
