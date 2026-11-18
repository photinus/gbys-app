import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/lib/dal/context";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const ctx = await requireSession();
  return (
    <AppShell user={{ name: ctx.name, email: ctx.email, image: ctx.image, orgRole: ctx.orgRole }}>
      {children}
    </AppShell>
  );
}
