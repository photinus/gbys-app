"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { QueueRow } from "@/lib/dal/compliance";
import { formatDate } from "@/lib/format";
import { CredentialStatusBadge } from "./credential-status-badge";
import { ReviewSheet } from "./review-sheet";

export function VerificationQueueTable({
  rows,
  currentUserId,
}: {
  rows: QueueRow[];
  currentUserId: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  if (rows.length === 0) {
    return <EmptyState title="Nothing here" description="No credentials match this filter." />;
  }

  return (
    <>
      <Table className="min-w-[760px]">
        <THead>
          <tr>
            <TH className="pl-2">Volunteer</TH>
            <TH>Credential</TH>
            <TH>Issuer / Ref</TH>
            <TH>Valid through</TH>
            <TH className="text-right pr-2">Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(r.id);
                }
              }}
              data-testid="queue-row"
            >
              <TD className="pl-2">
                <div className="font-semibold text-charcoal">{r.volunteerName || r.volunteerEmail}</div>
                {r.volunteerName ? <div className="text-xs text-stone-500">{r.volunteerEmail}</div> : null}
              </TD>
              <TD className="text-charcoal">{r.definitionName}</TD>
              <TD>
                <div className="text-sm text-charcoal">{r.issuerPartner}</div>
                <div className="font-mono text-xs text-stone-500">{r.referenceNumber ?? "-"}</div>
              </TD>
              <TD className="text-stone-600">{r.expiresAt ? formatDate(r.expiresAt) : "-"}</TD>
              <TD className="pr-2 text-right">
                <CredentialStatusBadge status={r.status} expiresAt={r.expiresAt} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <ReviewSheet
        key={selected?.id ?? "none"}
        row={selected}
        currentUserId={currentUserId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
