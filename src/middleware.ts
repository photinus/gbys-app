import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { embedFrameAncestors } from "@/lib/embed-origins";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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
  if (!getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/household/:path*",
    "/volunteer/:path*",
    "/admin/:path*",
    "/registrations/:path*",
    "/programs/:path*",
    "/teams/:path*",
    "/schedule/:path*",
    "/finance/:path*",
    "/embed/:path*",
  ],
};
