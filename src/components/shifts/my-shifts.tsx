"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ui";
import { cancelSignupAction } from "@/app/(portal)/volunteer/shifts/actions";
import type { MyShiftItem } from "@/lib/dal/shifts";
import { formatTimeRange } from "@/lib/format";

export function MyShifts({ shifts }: { shifts: MyShiftItem[] }) {
  const toast = useToast();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const cancel = async (id: string) => {
    setBusyId(id);
    const res = await cancelSignupAction(id);
    setBusyId(null);
    if (res.ok) {
      toast.success("Sign-up cancelled");
      startTransition(() => router.refresh());
    } else toast.error(res.error);
  };

  return (
    <Card>
      <CardHeader title="My shifts" description="Shifts you signed up for, plus the last 30 days." />
      {shifts.length === 0 ? (
        <EmptyState title="No shifts yet" description="Sign up for a shift above and it will show here." />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Shift</TH>
              <TH>When</TH>
              <TH>Status</TH>
              <TH className="text-right" aria-label="Actions" />
            </tr>
          </THead>
          <TBody>
            {shifts.map((s) => (
              <TR key={s.signupId}>
                <TD>
                  <p className="font-semibold text-charcoal">{s.title}</p>
                  <p className="text-xs text-stone-500">
                    {[s.programName ?? "Organization-wide", s.location].filter(Boolean).join(" · ")}
                  </p>
                </TD>
                <TD className="text-stone-600">{formatTimeRange(s.startsAt, s.endsAt)}</TD>
                <TD>
                  {s.shiftCancelled ? (
                    <Badge tone="danger">Shift cancelled</Badge>
                  ) : s.checkedInAt ? (
                    <Badge tone="success">Checked in</Badge>
                  ) : s.isUpcoming ? (
                    <Badge tone="info">Signed up</Badge>
                  ) : (
                    <Badge tone="neutral">Not checked in</Badge>
                  )}
                </TD>
                <TD className="text-right">
                  {s.canCancel && !s.shiftCancelled ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === s.signupId}
                      onClick={() => cancel(s.signupId)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
