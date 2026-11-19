"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { buttonStyles } from "@/components/ui/button";

/**
 * Header "Sign in" that returns the visitor to the public page they were on
 * (e.g. /register/cal-ripken) after Google, Apple or magic-link sign-in. The
 * sign-in page still validates `next` with safeNext (same-origin paths only).
 */
function SignInLinkInner({ className }: { className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  const here = pathname && pathname !== "/" && !pathname.startsWith("/sign-in") ? pathname + (search ? `?${search}` : "") : null;
  const href = here ? `/sign-in?next=${encodeURIComponent(here)}` : "/sign-in";
  return (
    <Link href={href} className={className ?? buttonStyles({ variant: "secondary" })}>
      Sign in
    </Link>
  );
}

export function SignInLink({ className }: { className?: string }) {
  return (
    <Suspense
      fallback={
        <Link href="/sign-in" className={className ?? buttonStyles({ variant: "secondary" })}>
          Sign in
        </Link>
      }
    >
      <SignInLinkInner className={className} />
    </Suspense>
  );
}
