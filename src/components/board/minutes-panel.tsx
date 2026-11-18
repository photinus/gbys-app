"use client";

import { useState, useTransition } from "react";
import { Badge, Button, EmptyState, Modal, Textarea, useToast } from "@/components/ui";
import { approveMinutesAction, saveMinutesAction, setMinutesPublicAction } from "@/app/(admin)/admin/board/meetings/actions";
import type { MinutesRecord } from "@/lib/dal/board-meetings";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MINUTES_MAX_CHARS } from "@/lib/validation/board";
import { Markdown } from "./markdown";

export function MinutesPanel({ meetingId, minutes, disabled }: { meetingId: string; minutes: MinutesRecord[]; disabled?: boolean }) {
  const toast = useToast();
  const latest = minutes[0] ?? null;
  const draft = latest && latest.status === "draft" ? latest : null;
  const [correcting, setCorrecting] = useState(false);
  const [body, setBody] = useState(draft?.body ?? "");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const editorOpen = !disabled && (!!draft || !latest || correcting);
  const dirty = draft ? body !== draft.body : body.trim() !== "";
  const nextVersion = (latest?.version ?? 0) + (draft ? 0 : 1);

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveMinutesAction(meetingId, body);
      if (res.ok) {
        setCorrecting(false);
        toast.success(`Draft v${res.data.version} saved`);
      } else setError(res.error);
    });
  const approve = () =>
    start(async () => {
      if (!draft) return;
      setError(null);
      const res = await approveMinutesAction(draft.id);
      setConfirming(false);
      if (res.ok) {
        toast.success(`Minutes v${res.data.version} approved`);
        setBody("");
      } else setError(res.error);
    });
  const togglePublic = (m: MinutesRecord) =>
    start(async () => {
      setError(null);
      const res = await setMinutesPublicAction(m.id, !m.isPublic);
      if (res.ok) toast.success(m.isPublic ? "Minutes are board-only again" : "Minutes are now visible to members");
      else setError(res.error);
    });

  return (
    <div className="space-y-4" data-testid="minutes-panel">
      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}

      {editorOpen ? (
        <div className="space-y-3 rounded-2xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-charcoal">
              {draft ? `Editing draft v${draft.version}` : latest ? `Correction: new version v${nextVersion}` : "Write the minutes (v1)"}
            </p>
            <div className="flex gap-1 rounded-full border border-line bg-white p-0.5 text-xs font-semibold" role="tablist" aria-label="Editor mode">
              {(["write", "preview"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cn("rounded-full px-3 py-1.5 capitalize", tab === t ? "bg-charcoal text-white" : "text-stone-600 hover:bg-alabaster")}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tab === "write" ? (
            <Textarea
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              maxLength={MINUTES_MAX_CHARS}
              aria-label="Minutes (Markdown)"
              placeholder={"## Call to order\nMeeting called to order at 6:02 PM.\n\n## Motions\n- Motion to approve the budget. Passed 4-0."}
              className="font-mono text-xs"
            />
          ) : (
            <div className="min-h-[12rem] rounded-xl border border-line-soft bg-white p-4" data-testid="minutes-preview">
              {body.trim() ? <Markdown source={body} /> : <p className="text-xs text-stone-400">Nothing to preview yet.</p>}
            </div>
          )}
          <p className="text-xs text-stone-500">Markdown: # headings, - lists, **bold**, [links](https://...). HTML is not allowed and shows as plain text.</p>
          <div className="flex flex-wrap justify-end gap-2">
            {correcting ? (
              <Button variant="secondary" size="sm" onClick={() => (setCorrecting(false), setBody(""))}>
                Discard
              </Button>
            ) : null}
            <Button variant="secondary" onClick={save} disabled={pending || !dirty || body.trim() === ""}>
              {pending ? "Saving..." : "Save draft"}
            </Button>
            {draft ? (
              <Button onClick={() => setConfirming(true)} disabled={pending || dirty}>
                Approve minutes
              </Button>
            ) : null}
          </div>
          {draft && dirty ? <p className="text-right text-xs text-stone-400">Save your changes before approving.</p> : null}
        </div>
      ) : latest && !disabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-alabaster/60 p-4">
          <p className="text-sm text-stone-600">
            Approved minutes can&apos;t be edited. To fix something, write a correction as a new version and approve it.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (setBody(latest.body), setTab("write"), setCorrecting(true))}
          >
            Write a correction
          </Button>
        </div>
      ) : null}

      {minutes.length === 0 ? (
        disabled ? <EmptyState title="No minutes" description="A cancelled meeting has no minutes." /> : null
      ) : (
        <ul className="space-y-3" data-testid="minutes-versions">
          {minutes.map((m) => (
            <li key={m.id} className="rounded-2xl border border-line p-4" data-testid="minutes-version">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-charcoal">Version {m.version}</span>
                  {m.status === "draft" ? <Badge tone="warning">Draft</Badge> : <Badge tone="success">Approved</Badge>}
                  {m.isPublic ? <Badge tone="info">Visible to members</Badge> : m.status === "approved" ? <Badge>Board only</Badge> : null}
                  {m.approvedAt ? <span className="text-xs text-stone-500">Approved {formatDateTime(m.approvedAt)}</span> : null}
                </div>
                {m.status === "approved" && !disabled ? (
                  <Button variant="secondary" size="sm" onClick={() => togglePublic(m)} disabled={pending}>
                    {m.isPublic ? "Make board-only" : "Publish to members"}
                  </Button>
                ) : null}
              </div>
              <details className="mt-3" open={m.status === "approved" && m.version === latest?.version}>
                <summary className="cursor-pointer text-xs font-semibold text-indigo-700">View text</summary>
                <div className="mt-3 rounded-xl bg-alabaster/50 p-4">
                  <Markdown source={m.body} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Approve these minutes?"
        description="Approved minutes become a permanent record and can't be edited. Later fixes are written as a new version."
      >
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Keep editing
          </Button>
          <Button onClick={approve} disabled={pending}>
            {pending ? "Approving..." : "Approve minutes"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
