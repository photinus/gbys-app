"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import type { BuilderPlayer, BuilderTeam } from "@/lib/dal/teams";
import {
  assignPlayersAction,
  removePlayerAction,
  setJerseyAction,
} from "@/app/(portal)/programs/[slug]/seasons/[seasonId]/teams/actions";
import { useRowAction } from "./use-row-action";

function PlayerRow({ player, team, others, path }: { player: BuilderPlayer; team: BuilderTeam; others: BuilderTeam[]; path: string }) {
  const { pending, run } = useRowAction();
  const [jersey, setJersey] = useState(player.jerseyNumber ?? "");

  const saveJersey = () => {
    if (jersey === (player.jerseyNumber ?? "")) return;
    const fd = new FormData();
    fd.set("teamPlayerId", player.teamPlayerId);
    fd.set("jersey", jersey);
    fd.set("path", path);
    run(() => setJerseyAction(null, fd), "Jersey saved");
  };
  const move = (toTeamId: string) => {
    if (!toTeamId) return;
    const fd = new FormData();
    fd.set("teamId", toTeamId);
    fd.append("registrationId", player.registrationId);
    fd.set("path", path);
    run(() => assignPlayersAction(null, fd), "Player moved");
  };
  const remove = () => {
    const fd = new FormData();
    fd.set("teamPlayerId", player.teamPlayerId);
    fd.set("path", path);
    run(() => removePlayerAction(null, fd), "Player removed");
  };

  return (
    <li className="space-y-2 rounded-2xl border border-line-soft bg-white px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-charcoal">{player.athleteName}</p>
        <span className="shrink-0 text-xs text-stone-500">{player.age === null ? "" : `Age ${player.age}`}</span>
      </div>
      <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
        <Input
          aria-label={`Jersey number for ${player.athleteName}`}
          placeholder="#"
          maxLength={3}
          value={jersey}
          onChange={(e) => setJersey(e.target.value)}
          onBlur={saveJersey}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveJersey();
            }
          }}
          disabled={pending}
        />
        <Select
          aria-label={`Move ${player.athleteName} to another team`}
          value=""
          onChange={(e) => move(e.target.value)}
          disabled={pending || others.length === 0}
        >
          <option value="">Move to…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Button variant="danger" size="sm" onClick={remove} disabled={pending} aria-label={`Remove ${player.athleteName} from ${team.name}`}>
          Remove
        </Button>
      </div>
    </li>
  );
}

export function TeamPlayersModal({ team, allTeams, path, onClose }: { team: BuilderTeam; allTeams: BuilderTeam[]; path: string; onClose: () => void }) {
  const others = allTeams.filter((t) => t.id !== team.id && t.isActive);
  return (
    <Modal open onClose={onClose} title={`${team.name} players`} description={`${team.players.length} on the team. Removed players go back to the unassigned list.`}>
      {team.players.length === 0 ? (
        <EmptyState title="No players yet" description="Select players in the unassigned list and assign them to this team." />
      ) : (
        <ul className="space-y-2.5">
          {team.players.map((p) => (
            <PlayerRow key={p.teamPlayerId} player={p} team={team} others={others} path={path} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
