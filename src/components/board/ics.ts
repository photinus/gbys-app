// Pure iCalendar builder (RFC 5545) for board meetings. Times are emitted as UTC
// instants (DTSTART:...Z), which calendar apps convert to the viewer's zone, so an
// America/Los_Angeles meeting lands at the right wall-clock time with no VTIMEZONE.

export interface IcsMeeting {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  virtualUrl: string | null;
  agenda: string | null;
  status: "scheduled" | "held" | "cancelled";
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function esc(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Fold a content line to 75 octets, never splitting a UTF-8 character. */
function fold(line: string): string {
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, "utf8");
    if (bytes + b > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildMeetingIcs(m: IcsMeeting, now: Date = new Date()): string {
  const end = m.endsAt ?? new Date(m.startsAt.getTime() + 60 * 60 * 1000);
  const descParts = [m.agenda, m.virtualUrl ? `Join online: ${m.virtualUrl}` : null].filter(Boolean) as string[];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gold Beach Youth Sports//Board Meetings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${m.id}@goldbeachyouthsports.org`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(m.startsAt)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${esc(m.title)}`,
    ...(m.location ? [`LOCATION:${esc(m.location)}`] : []),
    ...(descParts.length ? [`DESCRIPTION:${esc(descParts.join("\n\n"))}`] : []),
    ...(m.virtualUrl ? [`URL:${m.virtualUrl.replace(/[\r\n]/g, "")}`] : []),
    `STATUS:${m.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function icsFileName(startsAtLaDate: string): string {
  return `gbys-board-meeting-${startsAtLaDate}.ics`;
}
