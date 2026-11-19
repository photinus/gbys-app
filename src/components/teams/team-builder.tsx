"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { BuilderTeam, TeamBuilderData } from "@/lib/dal/teams";
import { TEAM_STAFF_ROLE_LABELS } from "@/lib/validation/teams";
import { TeamColorDot } from "./team-color";
import { TeamFormModal, type TeamFormValue } from "./team-form-modal";
import { TeamPlayersModal } from "./team-players-modal";
import { TeamStaffModal } from "./team-staff-modal";
import { UnassignedPanel } from "./unassigned-panel";

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; teamId: string }
  | { kind: "players"; teamId: string }
  | { kind: "staff"; teamId: string }
  | null;

function TeamCard({ team, slug, onDialog }: { team: BuilderTeam; slug: string; onDialog: (d: NonNullable<Dialog>) => void }) {
  const gaps = team.staff.filter((s) => s.readiness && !s.readiness.ready).length;
  return (
    <Card className="flex flex-col overflow-hidden p-0 sm:p-0">
      <div className="h-1.5" style={{ backgroundColor: team.color ?? "#95A9F9" }} />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-bold text-charcoal">
              <TeamColorDot color={team.color} />
              <span className="truncate">{team.name}</span>
            </h3>
            {team.division ? <p className="mt-0.5 truncate text-xs text-stone-500">{team.division}</p> : null}
          </div>
          {!team.isActive ? <Badge>Inactive</Badge> : null}
        </div>

        <dl className="grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-alabaster px-2 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Players</dt>
            <dd className="text-lg font-bold text-charcoal">{team.playerCount}</dd>
          </div>
          <div className="rounded-xl bg-alabaster px-2 py-2">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">Staff</dt>
            <dd className="text-lg font-bold text-charcoal">{team.staffCount}</dd>
          </div>
        </dl>

        <div className="min-h-[2.5rem] text-xs text-stone-600">
          {team.staff.length === 0 ? (
            <span className="text-stone-400">No coaches yet</span>
          ) : (
            <ul className="space-y-0.5">
              {team.staff.slice(0, 3).map((s) => (
                <li key={s.teamStaffId} className="truncate">
                  <span className="font-semibold text-charcoal">{s.name}</span> · {TEAM_STAFF_ROLE_LABELS[s.role]}
                </li>
              ))}
              {team.staff.length > 3 ? <li className="text-stone-400">+{team.staff.length - 3} more</li> : null}
            </ul>
          )}
          {gaps > 0 ? <Badge tone="warning" className="mt-1.5">{gaps} with credential gaps</Badge> : null}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="secondary" onClick={() => onDialog({ kind: "players", teamId: team.id })}>
            Players
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onDialog({ kind: "staff", teamId: team.id })}>
            Staff
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDialog({ kind: "edit", teamId: team.id })}>
            Edit
          </Button>
          <Link
            href={`/programs/${slug}/teams/${team.id}`}
            className="inline-flex items-center rounded-full px-3.5 py-2 text-xs font-semibold text-stone-600 hover:bg-alabaster hover:text-charcoal"
          >
            Open
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function TeamBuilder({ data, slug, path }: { data: TeamBuilderData; slug: string; path: string }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const { header, teams, unassigned } = data;

  const divisionHints = useMemo(() => [...new Set(teams.map((t) => t.division).filter((d): d is string => !!d))], [teams]);
  const teamOf = (id: string) => teams.find((t) => t.id === id) ?? null;

  const editing = dialog?.kind === "edit" ? teamOf(dialog.teamId) : null;
  const playersTeam = dialog?.kind === "players" ? teamOf(dialog.teamId) : null;
  const staffTeam = dialog?.kind === "staff" ? teamOf(dialog.teamId) : null;
  const editValue: TeamFormValue | null = editing
    ? { id: editing.id, name: editing.name, division: editing.division, color: editing.color, isActive: editing.isActive }
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section aria-label="Teams" className="min-w-0 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-charcoal">Teams ({teams.length})</h2>
          <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-4 w-4" />
            New team
          </Button>
        </div>
        {teams.length === 0 ? (
          <EmptyState
            title="No teams yet"
            description="Create the teams for this season, then place registered players on them."
            action={<Button onClick={() => setDialog({ kind: "create" })}>Create first team</Button>}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {teams.map((t) => (
              <TeamCard key={t.id} team={t} slug={slug} onDialog={setDialog} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Unassigned players" className="min-w-0">
        <UnassignedPanel unassigned={unassigned} teams={teams} path={path} />
      </section>

      {dialog?.kind === "create" ? (
        <TeamFormModal open onClose={close} team={null} seasonId={header.seasonId} slug={slug} path={path} divisionHints={divisionHints} />
      ) : null}
      {editValue ? (
        <TeamFormModal key={editValue.id} open onClose={close} team={editValue} seasonId={header.seasonId} slug={slug} path={path} divisionHints={divisionHints} />
      ) : null}
      {playersTeam ? <TeamPlayersModal team={playersTeam} allTeams={teams} path={path} onClose={close} /> : null}
      {staffTeam ? <TeamStaffModal team={staffTeam} path={path} onClose={close} /> : null}
    </div>
  );
}
