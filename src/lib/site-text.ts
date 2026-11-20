// Plain-text rendering for program home pages. Pure (no React, no server-only).
//
// Content is NEVER treated as HTML or Markdown: it is split into paragraphs (blank
// lines) and inline nodes (text | link). The React layer renders text nodes as text
// (React escapes them) and link nodes as <a rel="noopener noreferrer nofollow">.
// Only http(s) and mailto hrefs are ever produced; "javascript:", "data:" etc. stay
// plain text. URLs stop at whitespace, quotes and angle brackets, and trailing
// punctuation is not part of the link.

export type InlineNode = { type: "text"; value: string } | { type: "link"; href: string; label: string };
export type Paragraph = InlineNode[];

/** Hrefs a program page may link to: http(s) with a host, or mailto. */
export function isSafeHref(raw: string): boolean {
  const s = raw.trim();
  if (!s || /[\s<>"'`\u0000-\u001f]/.test(s)) return false;
  if (/^mailto:[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+(\?[^\s]*)?$/i.test(s)) return true;
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

// URL (http/https), explicit mailto:, or a bare email address.
const TOKEN_RE =
  /https?:\/\/[^\s<>"'`]+|mailto:[^\s<>"'`]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gi;

const TRAILING = /[.,;:!?'")\]}>]/;

/** Remove trailing punctuation from a matched token; keep a ")" that closes an "(" inside the URL. */
function trimToken(tok: string): { token: string; rest: string } {
  let end = tok.length;
  while (end > 0) {
    const ch = tok[end - 1];
    if (!TRAILING.test(ch)) break;
    if (ch === ")") {
      const body = tok.slice(0, end);
      const opens = (body.match(/\(/g) ?? []).length;
      const closes = (body.match(/\)/g) ?? []).length;
      if (closes <= opens) break;
    }
    end--;
  }
  return { token: tok.slice(0, end), rest: tok.slice(end) };
}

export function linkifyLine(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.value += value;
    else out.push({ type: "text", value });
  };
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    const { token } = trimToken(m[0]);
    // The regex's third alternative is a bare email address.
    const href = /^(https?:\/\/|mailto:)/i.test(token) ? token : `mailto:${token}`;
    if (isSafeHref(href)) {
      push(text.slice(last, start));
      out.push({ type: "link", href, label: token });
      last = start + token.length; // trailing punctuation stays as text
    }
  }
  push(text.slice(last));
  return out;
}

/** Split into paragraphs on blank lines; single newlines are kept inside a paragraph. */
export function parseSiteText(input: string | null | undefined): Paragraph[] {
  if (!input) return [];
  return input
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\s+$/g, ""))
    .filter((p) => p.trim().length > 0)
    .map((p) => linkifyLine(p));
}

/** Plain string of the text (for meta descriptions): collapses whitespace, truncates. */
export function plainExcerpt(input: string | null | undefined, max = 160): string {
  const s = (input ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}
