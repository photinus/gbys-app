import type { ReactNode } from "react";

/**
 * Tiny, dependency-free Markdown renderer for board minutes and agendas.
 *
 * Safety model: the output is built as React elements from plain text, never HTML
 * strings, and nothing uses dangerouslySetInnerHTML. React escapes every text node, so
 * raw HTML in the source (<script>, <img onerror>, ...) is shown as literal text.
 * Links are limited to http(s) and mailto; anything else (javascript:, data:, relative)
 * is rendered as its plain text. Images are not supported.
 *
 * Supported: headings (# to ######), paragraphs (single newlines kept), bullet and numbered lists,
 * blockquotes, horizontal rules, fenced code, inline code, bold, italic, [text](url) links and bare URLs.
 */

export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") return u.href;
  } catch {
    /* not an absolute URL */
  }
  return null;
}

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(text: string, keyBase: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.85em]">
          {m[1]}
        </code>
      );
    } else if (m[2] !== undefined) {
      out.push(<strong key={key}>{depth < 3 ? inline(m[2], key, depth + 1) : m[2]}</strong>);
    } else if (m[3] !== undefined) {
      out.push(<em key={key}>{depth < 3 ? inline(m[3], key, depth + 1) : m[3]}</em>);
    } else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-indigo-700 underline break-all">
            {m[4]}
          </a>
        ) : (
          m[0]
        )
      );
    } else if (m[6] !== undefined) {
      const href = safeHref(m[6]);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-indigo-700 underline break-all">
            {m[6]}
          </a>
        ) : (
          m[0]
        )
      );
    }
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withBreaks(lines: string[], key: string): ReactNode[] {
  return lines.flatMap((l, i) => (i === 0 ? inline(l, `${key}-${i}`) : [<br key={`${key}-br${i}`} />, ...inline(l, `${key}-${i}`)]));
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `b${k++}`;

  const isSpecial = (l: string) =>
    /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*[-*+]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l) || /^>\s?/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre key={key()} className="overflow-x-auto rounded-xl bg-stone-100 p-3 font-mono text-xs">
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const k2 = key();
      const content = inline(h[2], k2);
      blocks.push(
        level === 1 ? (
          <h2 key={k2} className="pt-2 text-lg font-bold text-charcoal">
            {content}
          </h2>
        ) : level === 2 ? (
          <h3 key={k2} className="pt-1 text-base font-bold text-charcoal">
            {content}
          </h3>
        ) : (
          <h4 key={k2} className="text-sm font-bold text-charcoal">
            {content}
          </h4>
        )
      );
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key()} className="border-line" />);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      const k2 = key();
      blocks.push(
        <blockquote key={k2} className="border-l-4 border-line pl-3 text-stone-600">
          {withBreaks(q, k2)}
        </blockquote>
      );
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items: string[] = [];
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      const k2 = key();
      const lis = items.map((t, idx) => <li key={`${k2}-${idx}`}>{inline(t, `${k2}-${idx}`)}</li>);
      blocks.push(
        ordered ? (
          <ol key={k2} className="list-decimal space-y-1 pl-5">
            {lis}
          </ol>
        ) : (
          <ul key={k2} className="list-disc space-y-1 pl-5">
            {lis}
          </ul>
        )
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !(para.length > 0 && isSpecial(lines[i]))) para.push(lines[i++]);
    const k2 = key();
    blocks.push(<p key={k2}>{withBreaks(para, k2)}</p>);
  }

  return <div className={["space-y-3 break-words text-sm leading-6 text-charcoal", className].filter(Boolean).join(" ")}>{blocks}</div>;
}
