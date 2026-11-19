"use client";

import { CalendarPlus, Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button, Input } from "@/components/ui";

export function feedUrls(baseUrl: string, token: string) {
  const https = `${baseUrl.replace(/\/+$/, "")}/calendar/team/${token}`;
  return { https, webcal: https.replace(/^https?:/, "webcal:") };
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the field is selectable */
    }
  };
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-stone-600">{label}</p>
      <div className="flex min-w-0 items-center gap-2">
        <Input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 text-xs" />
        <Button size="sm" variant="secondary" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** Calendar subscription links for one team. The URL is a secret: share it only with the team. */
export function SubscribePanel({ teamName, baseUrl, token }: { teamName: string; baseUrl: string; token: string }) {
  const { https, webcal } = feedUrls(baseUrl, token);
  return (
    <div data-testid="subscribe-panel" className="min-w-0 space-y-3 rounded-2xl border border-line bg-alabaster/60 p-4">
      <div className="flex items-start gap-2.5">
        <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-charcoal">Subscribe to {teamName}</p>
          <p className="text-xs text-stone-500">
            Add the schedule to Apple Calendar, Google Calendar or Outlook. It updates automatically. The link is private, so only share it with your team.
          </p>
        </div>
      </div>
      <a
        href={webcal}
        className="inline-flex items-center justify-center rounded-full bg-charcoal px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-stone-800"
      >
        Open in my calendar app
      </a>
      <CopyField label="Calendar feed link (https)" value={https} />
      <CopyField label="Calendar app link (webcal)" value={webcal} />
    </div>
  );
}
