import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/lib/dal/context";
import { buildShellUser } from "@/lib/dal/shell-user";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const ctx = await requireSession();
  return <AppShell user={await buildShellUser(ctx)}>{children}</AppShell>;
}
