"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, Field, Modal, Textarea, useToast } from "@/components/ui";
import type { BadgeTone } from "@/components/ui";
import { FormError } from "@/components/household/form-error";
import { useActionForm } from "@/components/household/use-action-form";
import type { ReviewRow } from "@/lib/dal/volunteer-roles";
import { formatDate } from "@/lib/format";
import { PROGRAM_ROLE_LABELS } from "@/lib/validation/programs";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/volunteer-roles";
import { ProgressBar } from "./progress-bar";
import type { RoleActions } from "./types";

const TONES: Record<ReviewRow["status"], BadgeTone> = {
  pending: "warning",
  active: "success",
  declined: "danger",
  withdrawn: "neutral",
  ended: "neutral",
};

type Dialog = { kind: "approve" | "decline" | "end"; row: ReviewRow } | null;

export function SignupsPanel({
  rows,
  showProgram,
  actions,
  emptyTitle = "No sign-ups yet",
  emptyDescription = "Volunteers appear here when they sign up for a role, or when you assign them.",
}: {
  rows: ReviewRow[];
  showProgram?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  actions: Pick<RoleActions, "approve" | "decline" | "end">;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const pending = rows.filter((r) => r.status === "pending");
  const active = rows.filter((r) => r.status === "active");
  const history = rows.filter((r) => r.status !== "pending" && r.status !== "active");

  const section = (title: string, list: ReviewRow[], testid: string) =>
    list.length ? (
      <section data-testid={testid} className="space-y-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
          {title} ({list.length})
        </h3>
        <ul className="space-y-2.5">
          {list.map((r) => (
            <SignupCard key={r.id} row={r} showProgram={showProgram} onAction={(kind) => setDialog({ kind, row: r })} />
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <div className="space-y-6">
      {/* Modals stay mounted when the list empties so the success toast still fires. */}
      {rows.length === 0 ? <EmptyState title={emptyTitle} description={emptyDescription} /> : null}
      {section("Waiting for approval", pending, "signups-pending")}
      {section("Active", active, "signups-active")}
      {section("History", history, "signups-history")}
      <Modal
        open={dialog?.kind === "approve"}
        onClose={() => setDialog(null)}
        title="Approve sign-up"
        description={dialog ? `${dialog.row.userName} for ${dialog.row.roleName} (${dialog.row.termLabel})` : undefined}
      >
        {dialog?.kind === "approve" ? <ApproveForm row={dialog.row} action={actions.approve} onDone={() => setDialog(null)} /> : null}
      </Modal>
      <Modal
        open={dialog?.kind === "decline" || dialog?.kind === "end"}
        onClose={() => setDialog(null)}
        title={dialog?.kind === "end" ? "End assignment" : "Decline sign-up"}
        description={dialog ? `${dialog.row.userName} for ${dialog.row.roleName} (${dialog.row.termLabel})` : undefined}
      >
        {dialog?.kind === "decline" || dialog?.kind === "end" ? (
          <ReasonForm
            key={`${dialog.kind}-${dialog.row.id}`}
            row={dialog.row}
            kind={dialog.kind}
            action={dialog.kind === "end" ? actions.end : actions.decline}
            onDone={() => setDialog(null)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function SignupCard({ row: r, showProgram, onAction }: { row: ReviewRow; showProgram?: boolean; onAction: (k: "approve" | "decline" | "end") => void }) {
  const selfBlocked = r.isSelf && !!r.grantsProgramRole;
  return (
    <li data-testid="signup-row" data-status={r.status} className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-charcoal">{r.userName}</span>
            <Badge tone={TONES[r.status]}>{ASSIGNMENT_STATUS_LABELS[r.status]}</Badge>
            {r.grantsProgramRole ? <Badge tone="warning">{PROGRAM_ROLE_LABELS[r.grantsProgramRole]} access</Badge> : null}
          </div>
          {r.userEmail ? <p className="break-all text-xs text-stone-500">{r.userEmail}</p> : null}
          <p className="text-sm text-charcoal">
            {r.roleName}
            <span className="text-stone-500">
              {" "}
              · {r.termLabel}
              {showProgram ? ` · ${r.programName ?? "Org-wide"}` : ""}
            </span>
          </p>
          <p className="text-xs text-stone-400">Signed up {formatDate(r.signedUpAt)}</p>
          {r.signupNote ? <p className="rounded-xl bg-alabaster px-3 py-2 text-xs text-stone-600">&ldquo;{r.signupNote}&rdquo;</p> : null}
          {r.status === "declined" || r.status === "ended" || r.status === "active" ? (
            <p className="text-xs text-stone-500">
              {r.status === "declined" && r.decidedAt ? `Declined ${formatDate(r.decidedAt)}${r.decidedByName ? ` by ${r.decidedByName}` : ""}. ` : null}
              {r.status === "ended" && r.endedAt ? `Ended ${formatDate(r.endedAt)}${r.endedByName ? ` by ${r.endedByName}` : ""}. ` : null}
              {r.status === "active" && r.decidedAt ? `Approved ${formatDate(r.decidedAt)}${r.decidedByName ? ` by ${r.decidedByName}` : ""}. ` : null}
              {r.status === "declined" && r.decisionNote ? `Reason: ${r.decisionNote}` : null}
              {r.status === "ended" && r.endReason ? `Reason: ${r.endReason}` : null}
            </p>
          ) : null}
        </div>
        {r.canManage && (r.status === "pending" || r.status === "active") ? (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {r.status === "pending" ? (
              <>
                <Button size="sm" disabled={selfBlocked} title={selfBlocked ? "Another manager must approve this" : undefined} onClick={() => onAction("approve")}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onAction("decline")}>
                  Decline
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => onAction("end")}>
                End
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {selfBlocked && r.status === "pending" ? (
        <p className="mt-2 text-xs text-amber-800">This is your own sign-up for a role that grants permissions. Another manager must approve it.</p>
      ) : null}
      {r.credentials.length && (r.status === "pending" || r.status === "active") ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Credential readiness">
          {r.credentials.map((c) => (
            <li
              key={c.id}
              data-testid="credential-flag"
              data-ok={c.ok}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${c.ok ? "bg-sage/40 text-emerald-900" : "bg-coral/40 text-rose-950"}`}
            >
              {c.ok ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
              {c.name}
              <span className="sr-only">{c.ok ? " verified" : " missing or expired"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {r.status === "active" || r.status === "ended" ? (
        <div className="mt-3">
          <ProgressBar verifiedMinutes={r.progress.verifiedMinutes} pendingMinutes={r.progress.pendingMinutes} expectedMinutes={r.expectedMinutes} />
        </div>
      ) : null}
    </li>
  );
}

function ApproveForm({ row, action, onDone }: { row: ReviewRow; action: RoleActions["approve"]; onDone: () => void }) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(action);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success("Sign-up approved", state.data.grantedAccess ? "Their program access is active now." : undefined);
    onDone();
  }, [state, toast, onDone]);
  const missing = row.credentials.filter((c) => !c.ok);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="id" value={row.id} />
      {missing.length ? (
        <div role="alert" data-testid="missing-credentials-warning" className="rounded-xl bg-amber-soft/40 px-3.5 py-3 text-xs text-amber-950">
          <p className="font-semibold">Missing or expired credentials</p>
          <p className="mt-0.5">{missing.map((c) => c.name).join(", ")}. You can still approve, but make sure this is intentional.</p>
        </div>
      ) : null}
      {row.grantsProgramRole ? (
        <p className="rounded-xl bg-alabaster px-3.5 py-3 text-xs text-stone-600">
          Approving gives {row.userName} {PROGRAM_ROLE_LABELS[row.grantsProgramRole]} access to {row.programName}, including rosters and emergency sheets, until the assignment ends.
        </p>
      ) : null}
      <Field label="Note (optional)">
        <Textarea name="note" rows={2} maxLength={500} />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Approving..." : missing.length ? "Approve anyway" : "Approve"}
        </Button>
      </div>
    </form>
  );
}

function ReasonForm({
  row,
  kind,
  action,
  onDone,
}: {
  row: ReviewRow;
  kind: "decline" | "end";
  action: RoleActions["decline"] | RoleActions["end"];
  onDone: () => void;
}) {
  const toast = useToast();
  const { state, pending, onSubmit } = useActionForm(action as RoleActions["decline"]);
  useEffect(() => {
    if (!state?.ok) return;
    toast.success(kind === "end" ? "Assignment ended" : "Sign-up declined");
    onDone();
  }, [state, toast, onDone, kind]);
  return (
    <form onSubmit={onSubmit} className="space-y-4 text-sm">
      <input type="hidden" name="id" value={row.id} />
      {kind === "end" ? (
        <p className="rounded-xl bg-alabaster px-3.5 py-3 text-xs text-stone-600">
          Their logged hours stay on the record.{row.grantsProgramRole ? " Any program access this role gave them is removed now." : ""}
        </p>
      ) : null}
      <Field label="Reason" hint="Kept in the audit log.">
        <Textarea name="reason" rows={3} required minLength={3} maxLength={500} />
      </Field>
      <FormError state={state} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Saving..." : kind === "end" ? "End assignment" : "Decline"}
        </Button>
      </div>
    </form>
  );
}
