import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { embedFrameAncestors } from "@/lib/embed-origins";
import { isCustomDomainPassthrough, isPrimaryHost, normalizeHost, primaryOrigin } from "@/lib/site-hosts";

/** Signed-in areas: optimistic cookie check here, real authorization in the DAL. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/household",
  "/volunteer",
  "/admin",
  "/registrations",
  "/programs",
  "/teams",
  "/schedule",
  "/finance",
  "/reimbursements",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Program custom domains (e.g. ripkenbaseball.org): "/" renders that program's home
  // page; assets pass through; every other path goes to the same path on the app's own
  // domain (sign-in, registration and auth cookies all live there).
  // Railway's edge passes the requested domain in Host. A spoofed Host only changes which
  // public program page the requester themselves sees.
  const host = normalizeHost(request.headers.get("host"));
  if (!isPrimaryHost(host)) {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = `/sites/domain/${host}`;
      return NextResponse.rewrite(url);
    }
    if (!isCustomDomainPassthrough(pathname)) {
      return NextResponse.redirect(new URL(pathname + search, primaryOrigin()), 307);
    }
    return NextResponse.next();
  }

  // Public embeddable pages (e.g. the contact form): no auth, and only the
  // allow-listed parent sites may frame them. Read at request time so changing
  // EMBED_ALLOWED_ORIGINS on Railway needs no rebuild. Every other page is
  // un-frameable via next.config.ts headers.
  if (pathname.startsWith("/embed/")) {
    const res = NextResponse.next();
    res.headers.set("Content-Security-Policy", `frame-ancestors ${embedFrameAncestors()}`);
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    return res;
  }

  // Optimistic check only (cookie presence). Real authorization happens in the DAL.
  if (isProtected(pathname) && !getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Every page (custom domains can request any path); static build assets are skipped.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
