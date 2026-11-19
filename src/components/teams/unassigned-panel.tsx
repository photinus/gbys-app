"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { BuilderTeam, UnassignedRegistration } from "@/lib/dal/teams";
import { assignPlayersAction } from "@/app/(portal)/programs/[slug]/seasons/[seasonId]/teams/actions";
import { useRowAction } from "./use-row-action";

export function UnassignedPanel({ unassigned, teams, path }: { unassigned: UnassignedRegistration[]; teams: BuilderTeam[]; path: string }) {
  const { pending, run } = useRowAction();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const activeTeams = teams.filter((t) => t.isActive);
  const [teamId, setTeamId] = useState("");

  // Filter choices come from the season's custom answers (e.g. "League age / division: Minors").
  const filterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of unassigned) for (const a of r.answers) if (a.value.length <= 40 && a.value !== "Yes" && a.value !== "No" && !/^\d+(\.\d+)?$/.test(a.value)) set.add(`${a.label}: ${a.value}`);
    return [...set].sort();
  }, [unassigned]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return unassigned.filter((r) => {
      if (q && !r.athleteName.toLowerCase().includes(q)) return false;
      if (filter && !r.answers.some((a) => `${a.label}: ${a.value}` === filter)) return false;
      return true;
    });
  }, [unassigned, search, filter]);

  // Selection survives filtering but ignores registrations that are no longer unassigned.
  const liveSelected = useMemo(() => {
    const ids = new Set(unassigned.map((r) => r.registrationId));
    return [...selected].filter((id) => ids.has(id));
  }, [selected, unassigned]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.registrationId));
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) shown.forEach((r) => next.delete(r.registrationId));
      else shown.forEach((r) => next.add(r.registrationId));
      return next;
    });

  const assign = () => {
    const fd = new FormData();
    fd.set("teamId", teamId);
    for (const id of liveSelected) fd.append("registrationId", id);
    fd.set("path", path);
    run(
      () => assignPlayersAction(null, fd),
      (d) => `${d.added + d.moved} player${d.added + d.moved === 1 ? "" : "s"} assigned`,
      () => setSelected(new Set())
    );
  };

  return (
    <Card>
      <CardHeader title="Unassigned players" description={`${unassigned.length} registered without a team.`} />
      {unassigned.length === 0 ? (
        <EmptyState title="Everyone has a team" description="New registrations show up here until you place them." />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label="Search players" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select aria-label="Filter by registration answer" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All answers</option>
              {filterOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <label className="flex cursor-pointer items-center gap-2 font-semibold text-stone-600">
              <input type="checkbox" checked={allShownSelected} onChange={toggleAll} className="h-4 w-4 rounded border-line" />
              Select all shown ({shown.length})
            </label>
            <span className="text-stone-500">{liveSelected.length} selected</span>
          </div>

          <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1" aria-label="Unassigned players">
            {shown.length === 0 ? (
              <li className="py-6 text-center text-xs text-stone-400">No players match.</li>
            ) : (
              shown.map((r) => {
                const checked = selected.has(r.registrationId);
                const detail = r.answers.filter((a) => a.value.length <= 40).slice(0, 2).map((a) => a.value).join(" · ");
                return (
                  <li key={r.registrationId}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line-soft bg-white px-3 py-2.5 has-[:checked]:border-periwinkle has-[:checked]:bg-lavender-card/60">
                      <input type="checkbox" checked={checked} onChange={() => toggle(r.registrationId)} className="h-4 w-4 shrink-0 rounded border-line" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-charcoal">{r.athleteName}</span>
                        {detail ? <span className="block truncate text-xs text-stone-500">{detail}</span> : null}
                      </span>
                      <span className="shrink-0 text-xs text-stone-500">{r.age === null ? "" : `Age ${r.age}`}</span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>

          <div className="flex flex-col gap-2 border-t border-line-soft pt-4 sm:flex-row">
            <Select aria-label="Assign to team" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={activeTeams.length === 0}>
              <option value="">{activeTeams.length === 0 ? "Create a team first" : "Choose a team…"}</option>
              {activeTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Button onClick={assign} disabled={pending || !teamId || liveSelected.length === 0} className="shrink-0">
              {pending ? "Assigning…" : `Assign ${liveSelected.length || ""} to team`.replace("  ", " ")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
