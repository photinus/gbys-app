import "server-only";
import type { ShellUser } from "@/components/shell/app-shell";
import { getMySeat } from "./board-shared";
import type { SessionContext } from "./context";
import { getFinanceAccess } from "./finance-access";
import { hasTeams, isProgramStaff, isShiftCoordinator } from "./permissions";

/** Everything the app shell needs to build the nav for this user (shared by all layouts). */
export async function buildShellUser(ctx: SessionContext): Promise<ShellUser> {
  const [seat, fin] = await Promise.all([getMySeat(ctx), getFinanceAccess(ctx)]);
  return {
    name: ctx.name,
    email: ctx.email,
    image: ctx.image,
    orgRole: ctx.orgRole,
    isShiftCoordinator: isShiftCoordinator(ctx),
    isProgramStaff: isProgramStaff(ctx),
    isSeatedDirector: !!seat,
    hasTeams: hasTeams(ctx),
    finance: fin.level ?? (fin.programs.length ? "program" : undefined),
  };
}
