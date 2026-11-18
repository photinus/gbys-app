import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { ProgramListRow } from "@/lib/dal/programs";

export function ProgramTable({ rows }: { rows: ProgramListRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="No programs yet" description="Create the first program to get started." />;
  }
  return (
    <Table className="min-w-[760px]">
      <THead>
        <tr>
          <TH className="pl-2">Program</TH>
          <TH>Sport</TH>
          <TH>Type</TH>
          <TH>Roles</TH>
          <TH>Status</TH>
          <TH className="pr-2 text-right">Hub</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id} data-testid="program-row">
            <TD className="pl-2">
              <Link href={`/admin/programs/${r.id}`} className="font-semibold text-charcoal hover:underline">
                {r.name}
              </Link>
              <div className="font-mono text-xs text-stone-500">{r.slug}</div>
            </TD>
            <TD className="text-charcoal">{r.sport}</TD>
            <TD>
              <Badge tone={r.isIndependentPartner ? "info" : "neutral"}>
                {r.isIndependentPartner ? "Independent partner" : "GBYS-run"}
              </Badge>
            </TD>
            <TD className="text-stone-600">
              {r.roleCount} total / {r.coachCount} coaches
            </TD>
            <TD>
              <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</Badge>
            </TD>
            <TD className="pr-2 text-right">
              <Link href={`/programs/${r.slug}`} data-testid="manage-program-link" className="text-xs font-semibold text-indigo-700 hover:underline">
                Manage
              </Link>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
