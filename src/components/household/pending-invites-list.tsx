"use client";

import { Mail } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from "@/components/ui";
import { revokeInviteAction } from "@/app/(portal)/household/actions";
import type { PendingInvite } from "@/lib/dal/households";
import { formatDate } from "@/lib/format";

export function PendingInvitesList({ invites }: { invites: PendingInvite[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function revoke(inv: PendingInvite) {
    if (!window.confirm(`Revoke the invitation to ${inv.email}?`)) return;
    setBusyId(inv.id);
    startTransition(async () => {
      const res = await revokeInviteAction(inv.id);
      setBusyId(null);
      if (res.ok) toast.success("Invitation revoked");
      else toast.error("Could not revoke", res.error);
    });
  }

  return (
    <Card>
      <CardHeader title="Pending invitations" description="Invitations you sent that have not been accepted." />
      {invites.length === 0 ? (
        <EmptyState title="No pending invitations" />
      ) : (
        <ul className="divide-y divide-line-soft">
          {invites.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-periwinkle/30 text-indigo-700">
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-charcoal">{inv.email}</p>
                  <p className="text-xs text-stone-500">
                    {inv.relationship} of {inv.athleteNames.join(", ") || "athletes"} - expires{" "}
                    {formatDate(inv.expiresAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="warning">Pending</Badge>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending && busyId === inv.id}
                  onClick={() => revoke(inv)}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
