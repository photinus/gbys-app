import { Badge, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import type { InsuranceCredentialStatus, InsuranceExport } from "@/lib/dal/insurance-export";
import { formatDob } from "@/lib/format";

const TONE: Record<InsuranceCredentialStatus, "success" | "warning" | "danger" | "neutral"> = {
  Verified: "success",
  "Pending review": "warning",
  Expired: "danger",
  Rejected: "danger",
  Missing: "neutral",
};

export function InsurancePlayersTable({ data }: { data: InsuranceExport }) {
  if (data.players.length === 0) {
    return <p className="py-6 text-center text-sm text-stone-500">No registered players.</p>;
  }
  return (
    <Table className="min-w-[900px] print:min-w-0 print:text-[10px]" data-testid="insurance-players">
      <THead>
        <tr>
          <TH className="pl-2">Player</TH>
          <TH>Date of birth</TH>
          <TH>Age</TH>
          <TH>Gender</TH>
          <TH>Team</TH>
          <TH>Jersey</TH>
          <TH>Primary guardian</TH>
        </tr>
      </THead>
      <TBody>
        {data.players.map((p) => (
          <TR key={p.registrationId} data-testid="insurance-player-row">
            <TD className="pl-2 font-semibold text-charcoal">
              {p.lastName}, {p.firstName}
            </TD>
            <TD>{formatDob(p.dateOfBirth)}</TD>
            <TD>{p.ageAtSeasonStart ?? ""}</TD>
            <TD>{p.gender}</TD>
            <TD>
              {p.team || <span className="text-stone-400">Unassigned</span>}
              {p.division ? <div className="text-xs text-stone-500">{p.division}</div> : null}
            </TD>
            <TD>{p.jerseyNumber}</TD>
            <TD>
              {p.guardianName}
              <div className="text-xs text-stone-500">
                {[p.guardianPhone, p.guardianEmail].filter(Boolean).join(" · ")}
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export function InsuranceStaffTable({ data }: { data: InsuranceExport }) {
  if (data.staff.length === 0) {
    return <p className="py-6 text-center text-sm text-stone-500">No coaches or team managers assigned.</p>;
  }
  return (
    <Table className="min-w-[760px] print:min-w-0 print:text-[10px]" data-testid="insurance-staff">
      <THead>
        <tr>
          <TH className="pl-2">Name</TH>
          <TH>Role</TH>
          <TH>Team</TH>
          <TH>Contact</TH>
          {data.credentials.map((c) => (
            <TH key={c.id}>{c.name}</TH>
          ))}
        </tr>
      </THead>
      <TBody>
        {data.staff.map((s, i) => (
          <TR key={`${s.userId}-${s.team}-${i}`} data-testid="insurance-staff-row">
            <TD className="pl-2 font-semibold text-charcoal">{s.name}</TD>
            <TD>{s.role}</TD>
            <TD>{s.team}</TD>
            <TD className="text-xs text-stone-600">{[s.phone, s.email].filter(Boolean).join(" · ")}</TD>
            {s.credentials.map((c, j) => (
              <TD key={j}>
                <Badge tone={TONE[c.status]}>{c.status}</Badge>
                {c.expiresOn ? <div className="mt-0.5 text-xs text-stone-500">expires {formatDob(c.expiresOn)}</div> : null}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
