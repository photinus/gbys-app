"use client";

import { Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteSubmissionAction,
  loadMoreSubmissionsAction,
  openSubmissionAction,
  setSubmissionStatusAction,
} from "@/app/(admin)/admin/contact/actions";
import { Button, EmptyState, Modal, Sheet, buttonStyles, useToast } from "@/components/ui";
import type { ContactScope, SubmissionDetail, SubmissionRow } from "@/lib/dal/contact-forms";
import { formatDateTime } from "@/lib/format";
import type { InboxFilters, SubmissionStatus } from "@/lib/validation/contact-forms";
import { cn } from "@/lib/utils";
import { SubmissionStatusBadge } from "./status-badge";

export function Inbox({
  scope,
  filters,
  initialRows,
  initialCursor,
  canDelete,
  showForm,
}: {
  scope: ContactScope;
  filters: InboxFilters;
  initialRows: SubmissionRow[];
  initialCursor: string | null;
  canDelete: boolean;
  /** Show the form title on each row (more than one form in scope). */
  showForm: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, startMore] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patchRow = (id: string, status: SubmissionStatus) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));

  const open = async (row: SubmissionRow) => {
    setOpenId(row.id);
    setDetail(null);
    setLoadError(null);
    const res = await openSubmissionAction(row.id);
    if (res.ok) {
      setDetail(res.data);
      patchRow(row.id, res.data.status);
      router.refresh();
    } else {
      setLoadError(res.error);
    }
  };
  const close = () => {
    setOpenId(null);
    setDetail(null);
    setConfirmDelete(false);
  };

  const changeStatus = async (status: SubmissionStatus) => {
    if (!detail) return;
    setBusy(true);
    const res = await setSubmissionStatusAction(detail.id, status);
    setBusy(false);
    if (!res.ok) return toast.error("Couldn't update", res.error);
    setDetail({ ...detail, status: res.data.status });
    patchRow(detail.id, res.data.status);
    toast.success(status === "archived" ? "Archived" : status === "spam" ? "Marked as spam" : status === "new" ? "Marked as new" : "Marked as read");
    router.refresh();
  };

  const doDelete = async () => {
    if (!detail) return;
    setBusy(true);
    const res = await deleteSubmissionAction(detail.id);
    setBusy(false);
    if (!res.ok) return toast.error("Couldn't delete", res.error);
    setRows((rs) => rs.filter((r) => r.id !== detail.id));
    toast.success("Message deleted");
    close();
    router.refresh();
  };

  const loadMore = () =>
    startMore(async () => {
      if (!cursor) return;
      const res = await loadMoreSubmissionsAction({ scope, formId: filters.formId, status: filters.status, q: filters.q, cursor });
      if (!res.ok) return toast.error("Couldn't load more", res.error);
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...res.data.rows.filter((r) => !seen.has(r.id))];
      });
      setCursor(res.data.nextCursor);
    });

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No messages here"
        description={filters.q || filters.formId || (filters.status && filters.status !== "open") ? "Nothing matches these filters." : "New messages from your contact forms will show up here."}
      />
    );
  }

  const status = detail?.status;
  return (
    <>
      <ul className="divide-y divide-line-soft" data-testid="inbox-list">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              data-testid="inbox-row"
              data-status={r.status}
              onClick={() => open(r)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-xl px-1 py-3.5 text-left hover:bg-alabaster/70 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_auto_auto] md:items-center md:gap-x-4"
            >
              <div className="min-w-0">
                <p className={cn("truncate text-sm text-charcoal", r.status === "new" ? "font-bold" : "font-medium")}>{r.name}</p>
                <p className="truncate text-xs text-stone-500">{r.email}</p>
              </div>
              <time dateTime={r.createdAt} className="text-xs tabular-nums text-stone-500 md:order-3">
                {formatDateTime(r.createdAt)}
              </time>
              <div className="col-span-2 min-w-0 md:order-2 md:col-span-1">
                <p className="truncate text-sm text-stone-600">{r.preview}</p>
                {showForm ? <p className="truncate text-xs text-stone-400">{r.formTitle}</p> : null}
              </div>
              <div className="col-start-2 row-start-2 justify-self-end md:order-4 md:col-start-auto md:row-start-auto">
                <SubmissionStatusBadge status={r.status} />
              </div>
            </button>
          </li>
        ))}
      </ul>
      {cursor ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore} data-testid="load-more">
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      ) : null}

      <Sheet
        open={openId !== null}
        onClose={close}
        title={detail ? detail.name : "Message"}
        subtitle={detail ? `${detail.formTitle} · ${formatDateTime(detail.createdAt)}` : undefined}
        footer={
          detail ? (
            <div className="flex w-full flex-wrap gap-2" data-testid="sheet-actions">
              <a
                href={`mailto:${detail.email}?subject=${encodeURIComponent(`Re: ${detail.formTitle}`)}`}
                className={buttonStyles({ size: "sm" })}
                data-testid="reply-button"
              >
                <Mail className="h-4 w-4" /> Reply
              </a>
              {status === "archived" ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeStatus("read")}>
                  Unarchive
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeStatus("archived")} data-testid="archive-button">
                  Archive
                </Button>
              )}
              {status === "spam" ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeStatus("read")}>
                  Not spam
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => changeStatus("spam")}>
                  Spam
                </Button>
              )}
              {status === "read" ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => changeStatus("new")}>
                  Mark unread
                </Button>
              ) : null}
              {canDelete ? (
                <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)} data-testid="delete-button">
                  Delete
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        {loadError ? (
          <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
            {loadError}
          </p>
        ) : !detail ? (
          <p className="text-sm text-stone-500">Loading...</p>
        ) : (
          <div className="space-y-5 text-sm" data-testid="submission-detail">
            <div className="flex items-center gap-2">
              <SubmissionStatusBadge status={detail.status} />
            </div>
            <dl className="grid gap-4">
              <Item label="Name">{detail.name}</Item>
              <Item label="Email">
                <a href={`mailto:${detail.email}`} className="break-all text-indigo-700 hover:underline">
                  {detail.email}
                </a>
              </Item>
              {detail.phone ? <Item label="Phone">{detail.phone}</Item> : null}
              {detail.answers.map((a) => (
                <Item key={a.key} label={a.label}>
                  {a.value || <span className="text-stone-400">No answer</span>}
                </Item>
              ))}
              <Item label="Message">
                <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{detail.message}</span>
              </Item>
              {detail.embedReferrer ? <Item label="Sent from">{detail.embedReferrer}</Item> : null}
            </dl>
          </div>
        )}
      </Sheet>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this message?"
        description="This permanently removes the message and everything the sender wrote. It can't be undone. The deletion is recorded in the audit log without the message contents."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy} onClick={doDelete} data-testid="confirm-delete">
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-stone-600">Use this for privacy removal requests. To just tidy the inbox, archive it instead.</p>
      </Modal>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-stone-400">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-charcoal [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
