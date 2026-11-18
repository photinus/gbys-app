"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { MyAssignmentRow } from "@/lib/dal/volunteer-role-signups";
import { ASSIGNMENT_STATUS_LABELS, PERIOD_LABELS, type AssignmentStatus } from "@/lib/volunteer-roles";
import { withdrawMyAssignmentAction } from "@/app/(portal)/volunteer/roles/actions";
import { HoursProgress } from "./progress-bar";

const TONES: Record<AssignmentStatus, BadgeTone> = {
  pending: "warning",
  active: "success",
  declined: "danger",
  withdrawn: "neutral",
  ended: "neutral",
};

function WithdrawButton({ a }: { a: MyAssignmentRow }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onClick() {
    if (busy) return;
    const msg =
      a.status === "pending"
        ? "Cancel this request?"
        : a.grantsAccess
          ? "Leave this role? You will also lose the roster access it gave you. Hours you already logged stay on record."
          : "Leave this role? Hours you already logged stay on record.";
    if (!window.confirm(msg)) return;
    setBusy(true);
    const res = await withdrawMyAssignmentAction(a.id);
    setBusy(false);
    if (res.ok) {
      toast.success(a.status === "pending" ? "Request cancelled" : "You left the role");
      router.refresh();
    } else {
      toast.error("Could not withdraw", res.error);
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={busy}>
      {busy ? "Working..." : a.status === "pending" ? "Cancel request" : "Leave role"}
    </Button>
  );
}

export function MyRoleCard({ a }: { a: MyAssignmentRow }) {
  return (
    <li className="rounded-2xl border border-line bg-alabaster/50 p-4" data-testid="my-role-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-base font-bold text-charcoal">{a.roleName}</h3>
          <p className="text-xs text-stone-500">
            {a.programName ?? "Organization-wide"} · {a.termLabel} · {PERIOD_LABELS[a.period]}
          </p>
        </div>
        <Badge tone={TONES[a.status]}>{ASSIGNMENT_STATUS_LABELS[a.status]}</Badge>
      </div>

      {a.status === "active" ? (
        <div className="mt-3">
          <HoursProgress
            verifiedMinutes={a.verifiedMinutes}
            pendingMinutes={a.pendingMinutes}
            expectedMinutes={a.expectedMinutes}
          />
        </div>
      ) : null}
      {a.status === "pending" ? (
        <p className="mt-3 text-sm text-stone-600">
          Waiting for approval.{a.grantsAccess ? " This role includes roster access, so a program leader reviews it first." : ""}
        </p>
      ) : null}
      {a.status === "declined" && a.decisionNote ? (
        <p className="mt-3 text-sm text-rose-900">Reason: {a.decisionNote}</p>
      ) : null}
      {a.status === "ended" && a.endReason ? (
        <p className="mt-3 text-sm text-stone-600">Ended: {a.endReason}</p>
      ) : null}
      {(a.status === "ended" || a.status === "withdrawn") && a.verifiedMinutes + a.pendingMinutes > 0 ? (
        <div className="mt-3">
          <HoursProgress
            verifiedMinutes={a.verifiedMinutes}
            pendingMinutes={a.pendingMinutes}
            expectedMinutes={a.expectedMinutes}
          />
        </div>
      ) : null}

      {a.isLive ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {a.status === "active" ? (
            <Link
              href={`/volunteer/hours?role=${a.id}`}
              className={buttonStyles({ variant: "primary", size: "sm" })}
            >
              Log hours for this role
            </Link>
          ) : null}
          <WithdrawButton a={a} />
        </div>
      ) : null}
    </li>
  );
}
