import { redirect } from "next/navigation";
import { DalError, getSessionContext } from "@/lib/dal/context";
import { resolveManagedProgramId, startOnboarding } from "@/lib/dal/stripe-connect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe Account Link refresh_url: the link expired or was reused, so issue a new one. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/sign-in?next=${encodeURIComponent(`/programs/${slug}/payments/refresh`)}`);

  let url: string;
  try {
    const programId = await resolveManagedProgramId(ctx, slug);
    url = (await startOnboarding(ctx, programId)).url;
  } catch (err) {
    if (err instanceof DalError && (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")) {
      redirect("/dashboard");
    }
    console.error("[payments/refresh]", err instanceof Error ? err.message : err);
    redirect(`/programs/${encodeURIComponent(slug)}/payments?connect=error`);
  }
  redirect(url);
}
