import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { MyCredentialRow } from "@/lib/dal/compliance";
import { formatDate } from "@/lib/format";
import { CredentialStatusBadge } from "./credential-status-badge";

export function MyCredentialsTable({ rows }: { rows: MyCredentialRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No credentials submitted yet"
        description="Upload proof of your background check, SafeSport or concussion training to get cleared to volunteer."
      />
    );
  }
  return (
    <Table>
      <THead>
        <tr>
          <TH className="pl-2">Credential</TH>
          <TH>Issuer / Reference</TH>
          <TH>Submitted</TH>
          <TH>Valid through</TH>
          <TH className="text-right pr-2">Status</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id}>
            <TD className="pl-2 font-semibold text-charcoal">{r.definitionName}</TD>
            <TD>
              <div className="text-sm text-charcoal">{r.issuerPartner}</div>
              <div className="font-mono text-xs text-stone-500">{r.referenceNumber ?? "-"}</div>
            </TD>
            <TD className="text-stone-600">{formatDate(r.createdAt)}</TD>
            <TD className="text-stone-600">{r.expiresAt ? formatDate(r.expiresAt) : "-"}</TD>
            <TD className="pr-2 text-right">
              <div className="flex flex-col items-end gap-1">
                <CredentialStatusBadge status={r.status} expiresAt={r.expiresAt} />
                {r.status === "rejected" && r.reviewerNotes ? (
                  <p className="max-w-xs text-xs text-rose-800">Reason: {r.reviewerNotes}</p>
                ) : null}
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
