import { getTeamCalendarFeed } from "@/lib/dal/team-schedule";

export const dynamic = "force-dynamic";

/**
 * Public read-only team calendar feed, authorized by the secret token alone
 * (rotate it from the team overview to revoke). Unknown token -> 404. The body
 * carries no athlete data.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await getTeamCalendarFeed(token);
  if (body === null) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": 'inline; filename="gbys-team.ics"',
    },
  });
}
