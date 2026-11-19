import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { hasTeams, isProgramStaff, isShiftCoordinator } from "@/lib/dal/permissions";
import { getMySeat } from "@/lib/dal/board-shared";
import { DalError, requireOrgRole } from "@/lib/dal/context";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireOrgRole("super_admin", "board_member");
  } catch (err) {
    // Hide the existence of admin pages from non-board users.
    if (err instanceof DalError && err.code === "FORBIDDEN") notFound();
    throw err;
  }
  return (
    <AppShell user={{ name: ctx.name, email: ctx.email, image: ctx.image, orgRole: ctx.orgRole, isShiftCoordinator: isShiftCoordinator(ctx), isProgramStaff: isProgramStaff(ctx), isSeatedDirector: !!(await getMySeat(ctx)), hasTeams: hasTeams(ctx) }}>
      {children}
    </AppShell>
  );
}
