import { parseSiteText } from "@/lib/site-text";
import { cn } from "@/lib/utils";

/**
 * Plain-text renderer: paragraphs on blank lines, escaped by React, only http(s)/mailto
 * links (rel="noopener noreferrer nofollow"). Never uses dangerouslySetInnerHTML.
 */
export function SiteText({ text, className }: { text: string | null | undefined; className?: string }) {
  const paragraphs = parseSiteText(text);
  if (paragraphs.length === 0) return null;
  return (
    <div className={cn("space-y-3 break-words text-[15px] leading-relaxed text-stone-700", className)}>
      {paragraphs.map((nodes, i) => (
        <p key={i} className="whitespace-pre-line">
          {nodes.map((n, j) =>
            n.type === "text" ? (
              n.value
            ) : (
              <a
                key={j}
                href={n.href}
                rel="noopener noreferrer nofollow"
                {...(n.href.startsWith("http") ? { target: "_blank" } : {})}
                className="site-link break-all font-medium underline underline-offset-2"
              >
                {n.label}
              </a>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
