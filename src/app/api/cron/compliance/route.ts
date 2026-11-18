import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runComplianceSweep } from "@/lib/dal/cron-compliance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; unequal length is a mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer (.+)$/.exec(header);
  if (!m || !tokenMatches(m[1], secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runComplianceSweep();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[cron-compliance] sweep failed", err);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

// Only POST is exported: Next answers other methods with 405.
