const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

export function photoResponse(body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "image/webp",
      "Content-Length": String(body.length),
      "Cache-Control": "private, max-age=86400",
      Vary: "Cookie",
    },
  });
}

/** Bodyless 401/404 that is never cached and reveals nothing. */
export function plainStatus(status: 401 | 404): Response {
  return new Response(null, { status, headers: { ...SECURITY_HEADERS, "Cache-Control": "private, no-store" } });
}
