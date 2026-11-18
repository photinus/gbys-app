import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/dal/context";
import { safeNext } from "@/lib/safe-redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<{ next?: string | string[]; error?: string | string[] }>;

const first = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNext(first(sp.next));
  const error = first(sp.error);

  // Already signed in: skip the form.
  if (await getSessionContext()) redirect(next);

  return (
    <SignInForm
      next={next}
      initialError={error ?? null}
      googleEnabled={!!process.env.GOOGLE_CLIENT_ID}
    />
  );
}
