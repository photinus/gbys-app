import { redirect } from "next/navigation";
import { DalError, getSessionContext } from "@/lib/dal/context";
import { refreshAccountStatus, resolveManagedProgramId } from "@/lib/dal/stripe-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe Account Link return_url: sync the account's status, then show the payments page. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/sign-in?next=${encodeURIComponent(`/programs/${slug}/payments/return`)}`);

  let outcome: "ready" | "pending" | "error";
  try {
    const programId = await resolveManagedProgramId(ctx, slug);
    const s = await refreshAccountStatus(ctx, programId);
    outcome = s.onboardingComplete ? "ready" : "pending";
  } catch (err) {
    if (err instanceof DalError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) {
      redirect("/dashboard");
    }
    console.error("[payments/return]", err instanceof Error ? err.message : err);
    outcome = "error";
  }
  redirect(`/programs/${encodeURIComponent(slug)}/payments?connect=${outcome}`);
}
