"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { QueueRow } from "@/lib/dal/compliance";
import { formatDate, formatDateTime, laDateInputToUtc, utcToLaDateInput } from "@/lib/format";
import {
  getProofUrlAction,
  reviewCredentialAction,
} from "@/app/(admin)/admin/compliance/actions";
import { CredentialStatusBadge } from "./credential-status-badge";

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs font-medium text-stone-500">{label}</span>
      <span className="text-right text-xs font-semibold text-charcoal">{children}</span>
    </div>
  );
}

/** Rendered with key={row.id} so local form state resets per credential. */
export function ReviewSheet({
  row,
  currentUserId,
  onClose,
}: {
  row: QueueRow | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");
  const [expires, setExpires] = useState(row?.expiresAt ? utcToLaDateInput(row.expiresAt) : "");
  const [error, setError] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);

  const isOwn = row?.userId === currentUserId;
  const canReview = !!row && row.status === "pending_review" && !isOwn;

  async function viewProof() {
    if (!row) return;
    setError(null);
    setProofBusy(true);
    // Open synchronously (popup blockers), then point it at the short-lived URL.
    const win = window.open("", "_blank");
    try {
      const res = await getProofUrlAction(row.id);
      if (!res.ok) {
        win?.close();
        setError(res.error);
        return;
      }
      if (win) {
        win.opener = null;
        win.location.href = res.data.url;
      } else {
        window.location.assign(res.data.url);
      }
    } catch {
      win?.close();
      setError("Could not open the proof file. Please try again.");
    } finally {
      setProofBusy(false);
    }
  }

  function decide(decision: "verified" | "rejected") {
    if (!row) return;
    if (decision === "rejected" && !notes.trim()) {
      setError("Add a note explaining why this is being rejected.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await reviewCredentialAction(row.id, {
          decision,
          reviewerNotes: notes.trim() || undefined,
          expiresAt:
            decision === "verified" && expires && expires !== (row.expiresAt ? utcToLaDateInput(row.expiresAt) : "")
              ? laDateInputToUtc(expires).toISOString()
              : undefined,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        toast.success(decision === "verified" ? "Credential verified" : "Credential rejected");
        onClose();
      } catch {
        setError("Something went wrong. Please try again.");
      }
    });
  }

  return (
    <Sheet
      open={!!row}
      onClose={onClose}
      title={row ? row.volunteerName || row.volunteerEmail : ""}
      subtitle={row ? `${row.volunteerEmail} • ${row.definitionName}` : undefined}
      footer={
        canReview ? (
          <>
            <Button className="flex-1" onClick={() => decide("verified")} disabled={pending}>
              <Check className="h-4 w-4" />
              Approve
            </Button>
            <Button variant="danger" onClick={() => decide("rejected")} disabled={pending}>
              <X className="h-4 w-4" />
              Reject
            </Button>
          </>
        ) : null
      }
    >
      {row ? (
        <>
          <div className="space-y-3 rounded-2xl border border-line/80 bg-alabaster p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-stone-500">Status</span>
              <CredentialStatusBadge status={row.status} expiresAt={row.expiresAt} />
            </div>
            <Meta label="Credential">{row.definitionName}</Meta>
            <Meta label="Issuer partner">{row.issuerPartner}</Meta>
            <Meta label="Reference number">
              <span className="font-mono">{row.referenceNumber ?? "-"}</span>
            </Meta>
            <Meta label="Issued">{row.issuedAt ? formatDate(row.issuedAt) : "-"}</Meta>
            <Meta label="Valid through">{row.expiresAt ? formatDate(row.expiresAt) : "-"}</Meta>
            <Meta label="Submitted">{formatDateTime(row.createdAt)}</Meta>
            {row.reviewedAt ? (
              <Meta label="Reviewed">
                {formatDateTime(row.reviewedAt)}
                {row.reviewerName ? ` by ${row.reviewerName}` : ""}
              </Meta>
            ) : null}
          </div>

          <div>
            <Button variant="secondary" size="sm" onClick={viewProof} disabled={proofBusy || !row.hasProof}>
              <ExternalLink className="h-4 w-4" />
              {proofBusy ? "Opening..." : row.hasProof ? "View proof" : "No proof uploaded"}
            </Button>
            <p className="mt-1.5 text-xs text-stone-400">
              Opens a private link that expires in 5 minutes. Each view is recorded in the audit log.
            </p>
          </div>

          {row.status !== "pending_review" && row.reviewerNotes ? (
            <div>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-stone-400">Reviewer notes</h4>
              <p className="whitespace-pre-wrap rounded-xl bg-alabaster p-3 text-sm text-charcoal">{row.reviewerNotes}</p>
            </div>
          ) : null}

          {isOwn && row.status === "pending_review" ? (
            <p className="rounded-xl bg-amber-soft/35 px-3.5 py-2.5 text-sm font-medium text-amber-950">
              This is your own credential. Another board member must review it.
            </p>
          ) : null}

          {canReview ? (
            <div className="space-y-4">
              <Field label="Valid through" hint="Adjust only if the proof shows a different expiry.">
                <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} disabled={pending} />
              </Field>
              <Field label="Notes" hint="Required when rejecting. Shown to the volunteer.">
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={2000}
                  disabled={pending}
                  placeholder="e.g. The confirmation number does not match the receipt."
                />
              </Field>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-sm font-medium text-rose-900">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
