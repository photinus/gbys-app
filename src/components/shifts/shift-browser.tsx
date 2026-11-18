"use client";

import { CalendarClock, MapPin, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Card, EmptyState, Select, useToast } from "@/components/ui";
import { cancelSignupAction, signUpAction } from "@/app/(portal)/volunteer/shifts/actions";
import type { ShiftListItem } from "@/lib/dal/shifts";
import type { ProgramOption } from "@/lib/dal/programs";
import { formatTimeRange } from "@/lib/format";
import { CATEGORY_LABELS } from "@/lib/volunteer-categories";

export function ShiftBrowser({
  shifts,
  programs,
  selectedProgram,
}: {
  shifts: ShiftListItem[];
  programs: ProgramOption[];
  selectedProgram: string;
}) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <Select
          aria-label="Filter by program"
          value={selectedProgram}
          onChange={(e) => {
            const v = e.target.value;
            router.replace(v ? `/volunteer/shifts?program=${encodeURIComponent(v)}` : "/volunteer/shifts");
          }}
        >
          <option value="">All programs</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      {shifts.length === 0 ? (
        <EmptyState
          title="No upcoming shifts"
          description="Nothing is open right now. Check back soon, or try another program."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {shifts.map((s) => (
            <ShiftCard key={s.id} shift={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftCard({ shift: s }: { shift: ShiftListItem }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const full = s.spotsFilled >= s.spotsTotal;
  const left = Math.max(0, s.spotsTotal - s.spotsFilled);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.ok) {
      toast.success(okMsg);
      startTransition(() => router.refresh());
    } else toast.error(res.error ?? "Something went wrong.");
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-charcoal">{s.title}</h3>
          <p className="text-xs text-stone-500">{s.programName ?? "Organization-wide"}</p>
        </div>
        <Badge tone="info">{CATEGORY_LABELS[s.category]}</Badge>
      </div>
      <ul className="space-y-1 text-sm text-stone-600">
        <li className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 shrink-0 text-stone-400" />
          {formatTimeRange(s.startsAt, s.endsAt)}
        </li>
        {s.location ? (
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-stone-400" />
            {s.location}
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-stone-400" />
          {s.spotsFilled} of {s.spotsTotal} spots filled
        </li>
      </ul>
      {s.description ? <p className="text-xs leading-relaxed text-stone-500">{s.description}</p> : null}
      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        <div>
          {s.myStatus === "checked_in" ? (
            <Badge tone="success">Checked in</Badge>
          ) : s.myStatus === "signed_up" ? (
            <Badge tone="success">You are signed up</Badge>
          ) : full ? (
            <Badge tone="warning">Full</Badge>
          ) : (
            <Badge tone="neutral">{left} left</Badge>
          )}
        </div>
        {s.myStatus === "signed_up" && s.mySignupId ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || pending || !s.signupOpen}
            onClick={() => run(() => cancelSignupAction(s.mySignupId!), "Sign-up cancelled")}
          >
            Cancel sign-up
          </Button>
        ) : s.myStatus === null ? (
          <Button
            size="sm"
            disabled={busy || pending || full || !s.signupOpen}
            onClick={() => run(() => signUpAction(s.id), "You are signed up")}
          >
            {s.signupOpen ? "Sign up" : "Started"}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
