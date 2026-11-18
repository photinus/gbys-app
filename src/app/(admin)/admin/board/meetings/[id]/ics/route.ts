import { buildMeetingIcs, icsFileName } from "@/components/board/ics";
import { DalError, getSessionContext, isBoard } from "@/lib/dal/context";
import { getMeeting } from "@/lib/dal/board-meetings";
import { utcToLaDateInput } from "@/lib/format";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Route handlers bypass layouts: authorize here. Hide existence from non-board users.
  const ctx = await getSessionContext();
  if (!ctx || !isBoard(ctx)) return notFound();
  const { id } = await params;
  try {
    const { meeting } = await getMeeting(ctx, id);
    return new Response(buildMeetingIcs(meeting), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${icsFileName(utcToLaDateInput(meeting.startsAt))}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof DalError || (e instanceof Error && e.name === "ZodError")) return notFound();
    throw e;
  }
}
