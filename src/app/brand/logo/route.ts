import { getLogoBytes } from "@/lib/dal/settings";

// Public: the logo is branding shown on signed-out pages too. Never SVG (sniffed on upload).
export const dynamic = "force-dynamic";

export async function GET() {
  let logo: Awaited<ReturnType<typeof getLogoBytes>> = null;
  try {
    logo = await getLogoBytes();
  } catch {
    logo = null;
  }
  if (!logo) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  return new Response(new Uint8Array(logo.bytes), {
    status: 200,
    headers: {
      "Content-Type": logo.contentType,
      "Content-Length": String(logo.bytes.length),
      // The URL carries ?v=<logoUpdatedAt>, so a new upload gets a new cache key.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
