"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader } from "@/components/ui";
import { slugSchema } from "@/lib/validation/contact-forms";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <Button
      variant="secondary"
      size="sm"
      data-testid={testId}
      onClick={async () => {
        setState((await copyText(text)) ? "done" : "failed");
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "done" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}

/** Hosted URL + copyable iframe/script snippet. Uses the live slug/title from the editor; `savedSlug` flags unsaved changes. */
export function EmbedPanel({
  appUrl,
  slug,
  title,
  savedSlug,
  isActive,
  allowedOrigins,
}: {
  appUrl: string;
  slug: string;
  title: string;
  savedSlug: string | null;
  isActive: boolean;
  allowedOrigins: string[];
}) {
  const valid = slugSchema.safeParse(slug).success;
  const hosted = `${appUrl}/contact/${valid ? slug : "<slug>"}`;
  const snippet =
    `<iframe src="${appUrl}/embed/contact/${valid ? slug : "<slug>"}" title="${escAttr(title.trim() || "Contact us")}" style="width:100%;border:0;min-height:240px" loading="lazy"></iframe>\n` +
    `<script src="${appUrl}/embed.js" async></script>`;
  const unsaved = savedSlug === null || savedSlug !== slug;

  return (
    <Card id="embed" className="scroll-mt-24" data-testid="embed-panel">
      <CardHeader title="Share and embed" description="Link to the hosted page, or embed the form on another website." />
      <div className="space-y-5 text-sm">
        {!isActive ? (
          <p className="rounded-xl bg-amber-soft/30 px-3.5 py-2.5 text-xs text-amber-950">This form is inactive. Visitors will see &ldquo;not available&rdquo; until you turn it on.</p>
        ) : null}
        {unsaved ? (
          <p className="rounded-xl bg-periwinkle/20 px-3.5 py-2.5 text-xs text-indigo-950">Save the form to make this URL live.</p>
        ) : null}

        <div>
          <p className="mb-1.5 text-xs font-semibold text-stone-500">Hosted page</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code data-testid="hosted-url" className="min-w-0 flex-1 break-all rounded-xl bg-alabaster px-3.5 py-2.5 text-xs text-charcoal">
              {hosted}
            </code>
            <CopyButton text={hosted} label="Copy link" testId="copy-link" />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-stone-500">Embed code</p>
          <pre data-testid="embed-snippet" className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-alabaster px-3.5 py-3 text-xs leading-relaxed text-charcoal">
            {snippet}
          </pre>
          <div className="mt-2">
            <CopyButton text={snippet} label="Copy embed code" testId="copy-embed" />
          </div>
        </div>

        <div className="rounded-xl bg-alabaster px-3.5 py-3 text-xs text-stone-600" data-testid="embed-origins-note">
          <p>
            Only these sites can show the embedded form:{" "}
            {allowedOrigins.length ? (
              allowedOrigins.map((o, i) => (
                <span key={o}>
                  {i > 0 ? ", " : ""}
                  <code className="break-all font-semibold text-charcoal">{o}</code>
                </span>
              ))
            ) : (
              <strong className="text-charcoal">none yet (the hosted page still works)</strong>
            )}
            . The list is the <code className="font-semibold">EMBED_ALLOWED_ORIGINS</code> setting on Railway; ask the site admin to add a new site there.
          </p>
        </div>
      </div>
    </Card>
  );
}
