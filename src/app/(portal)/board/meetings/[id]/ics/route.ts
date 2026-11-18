import { buildMeetingIcs, icsFileName } from "@/components/board/ics";
import { DalError, getSessionContext } from "@/lib/dal/context";
import { getPublicMeeting } from "@/lib/dal/board-meetings";
import { utcToLaDateInput } from "@/lib/format";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** Public meetings only; any signed-in member. Private meetings look like they don't exist. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  try {
    const { meeting } = await getPublicMeeting(ctx, id);
    return new Response(buildMeetingIcs(meeting), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${icsFileName(utcToLaDateInput(meeting.startsAt))}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DalError) return notFound();
    throw e;
  }
}
