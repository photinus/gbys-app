"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { setPublishedAction } from "@/app/(portal)/programs/[slug]/home-page/actions";
import { Badge, Button, buttonStyles, useToast } from "@/components/ui";

export function StatusCard({
  programId,
  programSlug,
  isPublished,
  pathSlug,
  customDomain,
  appOrigin,
}: {
  programId: string;
  programSlug: string;
  isPublished: boolean;
  pathSlug: string | null;
  customDomain: string | null;
  appOrigin: string;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const hasAddress = !!pathSlug || !!customDomain;
  const urls = [
    ...(pathSlug ? [`${appOrigin}/${pathSlug}`] : []),
    ...(customDomain ? [`https://${customDomain}/`] : []),
  ];

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setPublishedAction(programId, next);
      if (res.ok) toast.success(next ? "Home page published" : "Home page unpublished");
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-4 text-sm" data-testid="status-card">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={isPublished ? "success" : "neutral"} data-testid="publish-badge">
          {isPublished ? "Published" : "Draft"}
        </Badge>
        <p className="min-w-0 text-xs text-stone-500">
          {isPublished
            ? "Anyone with the link can see your home page."
            : "Only you and other program admins can see it, using Preview."}
        </p>
      </div>

      {!hasAddress ? (
        <p role="status" data-testid="no-address-warning" className="rounded-xl bg-amber-soft/40 px-3.5 py-2.5 text-xs font-medium text-amber-950">
          Set an address (see “Address &amp; visibility” below) before you can publish.
        </p>
      ) : null}

      {urls.length > 0 ? (
        <ul className="space-y-1 text-xs" data-testid="live-urls">
          {urls.map((u) => (
            <li key={u} className="min-w-0 break-all">
              {isPublished ? (
                <a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline">
                  {u} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                </a>
              ) : (
                <span className="text-stone-500">
                  Will be at <span className="font-semibold text-charcoal">{u}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
        <Link href={`/programs/${programSlug}/home-page/preview`} className={buttonStyles({ variant: "secondary" })} data-testid="preview-link">
          Preview
        </Link>
        {isPublished ? (
          <Button variant="secondary" onClick={() => toggle(false)} disabled={pending} data-testid="unpublish">
            {pending ? "Working..." : "Unpublish"}
          </Button>
        ) : (
          <Button onClick={() => toggle(true)} disabled={pending || !hasAddress} data-testid="publish">
            {pending ? "Publishing..." : "Publish"}
          </Button>
        )}
      </div>
    </div>
  );
}
