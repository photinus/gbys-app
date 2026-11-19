import { PhotoAvatar } from "@/components/photos/photo-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { OverviewPlayer } from "@/lib/dal/teams";
import { formatPhone } from "@/lib/validation/household";

function Guardians({ guardians }: { guardians: OverviewPlayer["guardians"] }) {
  if (guardians.length === 0) return <span className="text-stone-400">None on file</span>;
  return (
    <ul className="space-y-0.5">
      {guardians.map((g, i) => (
        <li key={i} className="text-sm">
          {g.name}
          {g.phone ? (
            <>
              {" · "}
              <a href={`tel:${g.phone}`} className="font-medium text-charcoal underline decoration-stone-300 underline-offset-2">
                {formatPhone(g.phone)}
              </a>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Roster: a table on wide screens, cards on phones. Never shows medical data. */
export function TeamRoster({ roster }: { roster: OverviewPlayer[] }) {
  if (roster.length === 0) {
    return <EmptyState title="No players on this team yet" description="Program admins add players from the season's team builder." />;
  }
  return (
    <>
      <div className="hidden md:block">
        <Table className="min-w-0">
          <THead>
            <tr>
              <TH className="w-16">#</TH>
              <TH>Player</TH>
              <TH>Age</TH>
              <TH>Guardians</TH>
            </tr>
          </THead>
          <TBody>
            {roster.map((p) => (
              <TR key={p.teamPlayerId}>
                <TD className="font-bold text-charcoal">{p.jerseyNumber ?? "–"}</TD>
                <TD>
                  <span className="flex items-center gap-3">
                    <PhotoAvatar name={p.athleteName} src={p.photoUrl} size="sm" />
                    <span className="font-semibold text-charcoal">{p.athleteName}</span>
                  </span>
                </TD>
                <TD>{p.age ?? "–"}</TD>
                <TD>
                  <Guardians guardians={p.guardians} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <ul className="space-y-3 md:hidden">
        {roster.map((p) => (
          <li key={p.teamPlayerId} className="rounded-2xl border border-line-soft bg-white p-4">
            <div className="flex items-center gap-3">
              <PhotoAvatar name={p.athleteName} src={p.photoUrl} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-charcoal">{p.athleteName}</p>
                <p className="text-xs text-stone-500">{p.age === null ? "" : `Age ${p.age}`}</p>
              </div>
              {p.jerseyNumber ? <span className="shrink-0 rounded-full bg-charcoal px-3 py-1 text-xs font-bold text-white">#{p.jerseyNumber}</span> : null}
            </div>
            <div className="mt-3 border-t border-line-soft pt-3 text-xs text-stone-500">
              <p className="mb-1 font-semibold uppercase tracking-wider text-stone-400">Guardians</p>
              <Guardians guardians={p.guardians} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
