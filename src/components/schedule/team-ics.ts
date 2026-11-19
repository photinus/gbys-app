// Pure iCalendar (RFC 5545) builder for a team's public feed. Mirrors the board
// module's rules (UTC instants, CRLF line endings, 75-octet folding on UTF-8
// boundaries) but escapes semicolons correctly. Deliberately takes NO athlete data.

export interface TeamIcsEvent {
  id: string;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  location: string | null;
  description: string | null;
  cancelled: boolean;
  /** Field booking still awaiting approval: published as STATUS:TENTATIVE. */
  tentative?: boolean;
  updatedAt: Date;
}

export function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Fold a content line to 75 octets, never splitting a UTF-8 character. */
export function foldIcsLine(line: string): string {
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
      limit = 74; // continuation lines begin with one space
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function buildTeamIcs(
  team: { id: string; name: string },
  events: TeamIcsEvent[],
  now: Date = new Date()
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gold Beach Youth Sports//Team Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(`${team.name} (GBYS)`)}`,
    "X-WR-TIMEZONE:America/Los_Angeles",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:team-event-${e.id}@goldbeachyouthsports.org`,
      `DTSTAMP:${utcStamp(now)}`,
      `LAST-MODIFIED:${utcStamp(e.updatedAt)}`,
      `DTSTART:${utcStamp(e.startsAt)}`,
      `DTEND:${utcStamp(e.endsAt)}`,
      `SUMMARY:${escapeIcsText(e.summary)}`,
      ...(e.location ? [`LOCATION:${escapeIcsText(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${escapeIcsText(e.description)}`] : []),
      `STATUS:${e.cancelled ? "CANCELLED" : e.tentative ? "TENTATIVE" : "CONFIRMED"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}
