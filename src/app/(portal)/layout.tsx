import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { isProgramStaff, isShiftCoordinator } from "@/lib/dal/permissions";
import { getMySeat } from "@/lib/dal/board-shared";
import { requireSession } from "@/lib/dal/context";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const ctx = await requireSession();
  return (
    <AppShell user={{ name: ctx.name, email: ctx.email, image: ctx.image, orgRole: ctx.orgRole, isShiftCoordinator: isShiftCoordinator(ctx), isProgramStaff: isProgramStaff(ctx), isSeatedDirector: !!(await getMySeat(ctx)) }}>
      {children}
    </AppShell>
  );
}
