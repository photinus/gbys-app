"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { loadMoreAuditAction } from "@/app/(admin)/admin/audit/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { AuditLogRow } from "@/lib/dal/audit-log";
import { cn } from "@/lib/utils";

const stampFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function targetHref(type: string, id: string): string | null {
  if (type === "user") return `/admin/users/${encodeURIComponent(id)}`;
  if (type === "program") return `/admin/programs/${encodeURIComponent(id)}`;
  return null;
}

/** Compact one-line summary: the first few scalar fields. */
function summarize(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return "";
  if (typeof metadata !== "object" || Array.isArray(metadata)) return JSON.stringify(metadata).slice(0, 120);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
    const val = v !== null && typeof v === "object" ? (Array.isArray(v) ? `[${v.length}]` : "{…}") : String(v);
    parts.push(`${k}: ${val}`);
    if (parts.length === 3) break;
  }
  return parts.join(" · ");
}

function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…` : id;
}

function Row({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const href = targetHref(row.targetType, row.targetId);
  const hasMeta = row.metadata !== null && row.metadata !== undefined;
  const summary = summarize(row.metadata);
  const panelId = `audit-meta-${row.id}`;
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <div className="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 px-1 py-3 md:grid-cols-[170px_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_32px] md:items-center md:gap-x-4">
        <time dateTime={row.createdAt} title={row.createdAt} className="text-xs font-medium tabular-nums text-stone-500 md:text-[13px]">
          {stampFmt.format(new Date(row.createdAt))}
        </time>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Hide details" : "Show details"}
          disabled={!hasMeta}
          className={cn(
            "row-span-2 flex h-8 w-8 items-center justify-center justify-self-end rounded-full text-stone-500 hover:bg-alabaster disabled:opacity-30 md:order-last md:row-span-1",
          )}
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
        </button>

        <div className="col-start-1 min-w-0 text-sm md:col-start-auto">
          <p className={cn("truncate font-semibold", row.actorUserId ? "text-charcoal" : "text-stone-500")}>{row.actorName}</p>
          {row.actorEmail ? <p className="truncate text-xs text-stone-400">{row.actorEmail}</p> : null}
        </div>

        <div className="col-start-1 flex min-w-0 flex-wrap items-center gap-1.5 md:col-start-auto">
          <code className="break-all rounded-md bg-alabaster px-1.5 py-0.5 text-xs font-medium text-charcoal">{row.action}</code>
          {row.action === "medical.viewed" ? <Badge tone="warning">Medical access</Badge> : null}
        </div>

        <div className="col-start-1 min-w-0 text-xs text-stone-600 md:col-start-auto">
          <span className="text-stone-400">{row.targetType}</span>{" "}
          {href ? (
            <Link href={href} title={row.targetId} className="font-semibold text-charcoal underline underline-offset-2">
              {shortId(row.targetId)}
            </Link>
          ) : (
            <span title={row.targetId} className="font-medium text-charcoal">
              {shortId(row.targetId)}
            </span>
          )}
        </div>

        <p className="col-start-1 min-w-0 truncate text-xs text-stone-500 md:col-start-auto">{summary || "—"}</p>
      </div>
      {open && hasMeta ? (
        <pre
          id={panelId}
          className="mb-3 max-h-72 overflow-auto rounded-2xl bg-alabaster p-3.5 text-xs leading-relaxed text-charcoal whitespace-pre-wrap break-words"
        >
          {JSON.stringify(row.metadata, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

export function AuditLogList({
  initialRows,
  initialCursor,
  query,
}: {
  initialRows: AuditLogRow[];
  initialCursor: string | null;
  /** Serialized filters (GET query string) so "Load more" repeats the same filter set. */
  query: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function loadMore() {
    if (!cursor) return;
    setError(null);
    start(async () => {
      const res = await loadMoreAuditAction(query, cursor);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...res.data.rows.filter((r) => !seen.has(r.id))];
      });
      setCursor(res.data.nextCursor);
    });
  }

  if (rows.length === 0) {
    return <EmptyState title="No matching audit entries" description="Try widening the date range or clearing a filter." />;
  }

  return (
    <div>
      <div
        aria-hidden
        className="hidden grid-cols-[170px_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_32px] gap-x-4 border-b border-[#ECEAE3] px-1 pb-3 text-[12px] font-semibold uppercase tracking-wider text-stone-400 md:grid"
      >
        <span>Time (Pacific)</span>
        <span>Actor</span>
        <span>Action</span>
        <span>Target</span>
        <span>Details</span>
        <span />
      </div>
      <ul>
        {rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ul>
      <div className="flex flex-col items-center gap-2 pt-4">
        {error ? (
          <p role="alert" className="text-xs font-medium text-rose-700">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-stone-400" aria-live="polite">
          Showing {rows.length.toLocaleString("en-US")} {rows.length === 1 ? "entry" : "entries"}
          {cursor ? "" : " (end of log)"}
        </p>
        {cursor ? (
          <Button variant="secondary" onClick={loadMore} disabled={pending}>
            {pending ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
