"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ListOrdered, Plus } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { BoardMemberView } from "@/lib/dal/board-members";
import { formatDateTime, formatDob } from "@/lib/format";
import { EndSeatModal } from "./end-seat-modal";
import { MemberFormModal } from "./member-form-modal";
import { PositionsModal } from "./positions-modal";
import { SeatBadges } from "./seat-badges";

export function MembersManager({ members, positions, showEnded }: { members: BoardMemberView[]; positions: string[]; showEnded: boolean }) {
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState<BoardMemberView | null>(null);
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState<BoardMemberView | null>(null);

  return (
    <Card>
      <CardHeader
        title="Seats and terms"
        description="Directors' terms in Pacific time. Voting rights come from a seated, linked seat, not from the admin role."
        action={
          <>
            <Link
              href={showEnded ? "/admin/board/members" : "/admin/board/members?show=all"}
              className="text-xs font-semibold text-indigo-700 hover:underline"
            >
              {showEnded ? "Hide ended seats" : "Show ended seats"}
            </Link>
            <Button size="sm" variant="secondary" onClick={() => setManaging(true)}>
              <ListOrdered className="h-4 w-4" aria-hidden /> Manage positions
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Add seat
            </Button>
          </>
        }
      />
      {members.length === 0 ? (
        <EmptyState title="No board seats yet" description="Add each director's seat to start scheduling meetings and recording attendance." />
      ) : (
        <Table className="min-w-[760px]" data-testid="members-table">
          <THead>
            <tr>
              <TH className="pl-2">Director</TH>
              <TH>Term</TH>
              <TH>Status</TH>
              <TH className="pr-2 text-right">Actions</TH>
            </tr>
          </THead>
          <TBody>
            {members.map((m) => (
              <TR key={m.id} data-testid="member-row" className={m.status === "ended" ? "opacity-70" : undefined}>
                <TD className="pl-2 align-top">
                  <div className="font-semibold text-charcoal">{m.displayName}</div>
                  <div className="text-xs text-stone-500">
                    {m.position}
                    {m.account ? ` · ${m.account.email}` : ""}
                  </div>
                  {m.warnings.map((w) => (
                    <p key={w.kind} className="mt-1 flex max-w-md items-start gap-1.5 text-xs text-amber-800">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>
                        {w.message}{" "}
                        {w.href ? (
                          <Link href={w.href} className="font-semibold underline">
                            Open user
                          </Link>
                        ) : null}
                      </span>
                    </p>
                  ))}
                </TD>
                <TD className="align-top whitespace-nowrap text-charcoal">
                  {formatDob(m.termStart)} – {m.termEnd ? formatDob(m.termEnd) : "open"}
                  {m.endedAt ? (
                    <div className="text-xs text-stone-500" title={m.endReason ?? undefined}>
                      Ended {formatDateTime(m.endedAt)}
                      {m.endReason ? ` (${m.endReason})` : ""}
                    </div>
                  ) : null}
                </TD>
                <TD className="align-top">
                  <SeatBadges status={m.status} daysLeft={m.daysLeft} isVotingDirector={m.isVotingDirector} />
                </TD>
                <TD className="pr-2 text-right align-top">
                  <div className="flex justify-end gap-1.5">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                      Edit
                    </Button>
                    {m.status !== "ended" ? (
                      <Button variant="ghost" size="sm" onClick={() => setEnding(m)}>
                        End seat
                      </Button>
                    ) : null}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <MemberFormModal open={adding || !!editing} onClose={() => (setAdding(false), setEditing(null))} member={editing} positions={positions} members={members} />
      <PositionsModal open={managing} onClose={() => setManaging(false)} positions={positions} members={members} />
      <EndSeatModal open={!!ending} onClose={() => setEnding(null)} member={ending} />
    </Card>
  );
}
