import { getSiteImage } from "@/lib/dal/program-sites";

// Public program home-page images (hero / logo). Never SVG (sniffed + re-encoded on upload).
export const dynamic = "force-dynamic";

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

export async function GET(request: Request, { params }: { params: Promise<{ programId: string; kind: string }> }) {
  const { programId, kind } = await params;
  if (kind !== "hero" && kind !== "logo") return notFound();
  let img: Awaited<ReturnType<typeof getSiteImage>> = null;
  try {
    img = await getSiteImage(programId, kind);
  } catch {
    img = null;
  }
  if (!img) return notFound();
  // Immutable only when the URL is versioned (?v=<updatedAt>); a bare URL must be revalidated soon.
  const versioned = new URL(request.url).searchParams.has("v");
  return new Response(new Uint8Array(img.bytes), {
    status: 200,
    headers: {
      "Content-Type": img.contentType,
      "Content-Length": String(img.bytes.length),
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
