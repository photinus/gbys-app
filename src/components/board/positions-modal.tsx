"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button, Input, Modal, useToast } from "@/components/ui";
import { savePositionsAction } from "@/app/(admin)/admin/board/members/actions";
import type { BoardMemberView } from "@/lib/dal/board-members";
import { POSITIONS_MAX_COUNT, POSITION_MAX, POSITION_MIN, positionListSchema, samePosition } from "@/lib/validation/board";

interface Row {
  key: number;
  /** The title this row started as (null for rows added in this session). */
  orig: string | null;
  value: string;
}

export function PositionsModal({ open, onClose, positions, members }: { open: boolean; onClose: () => void; positions: string[]; members: BoardMemberView[] }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage positions"
      description="The titles offered when adding a seat, in the order the roster is sorted. Changing this list never changes existing seats."
    >
      <PositionsEditor positions={positions} members={members} onDone={onClose} />
    </Modal>
  );
}

function PositionsEditor({ positions, members, onDone }: { positions: string[]; members: BoardMemberView[]; onDone: () => void }) {
  const toast = useToast();
  const nextKey = useRef(positions.length);
  const [rows, setRows] = useState<Row[]>(() => positions.map((p, i) => ({ key: i, orig: p, value: p })));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const focusKey = useRef<string | null>(null);

  const countFor = (title: string | null) => (title ? members.filter((m) => m.status !== "ended" && samePosition(m.position, title)).length : 0);

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    focusKey.current = `${next[j].key}-${dir === -1 ? "up" : "down"}`;
    setRows(next);
    // Keep focus on the moved row's button (it re-mounts in a new position only if keyed badly; keys are stable).
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-focus-id="${focusKey.current}"]`)?.focus());
  };

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    setRows([...rows, { key: nextKey.current++, orig: null, value: v }]);
    setDraft("");
    setError(null);
  };

  const removedInUse = positions
    .map((p) => ({ title: p, n: countFor(p) }))
    .filter(({ title, n }) => n > 0 && !rows.some((r) => r.orig === title && r.value.trim() !== "" && samePosition(r.value, title)));

  const save = async () => {
    const list = rows.map((r) => r.value.trim());
    const parsed = positionListSchema.safeParse(list);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the positions.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await savePositionsAction(parsed.data);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(res.data.changed ? "Positions saved" : "No changes to save");
    onDone();
  };

  return (
    <div className="space-y-4 text-sm">
      <ul className="space-y-2" data-testid="position-rows">
        {rows.map((r, i) => {
          const n = countFor(r.orig);
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-alabaster/50 p-2" data-testid="position-row">
              <div className="min-w-0 flex-1 basis-40">
                <Input
                  value={r.value}
                  onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, value: e.target.value } : x)))}
                  aria-label={`Position ${i + 1} title`}
                  minLength={POSITION_MIN}
                  maxLength={POSITION_MAX}
                />
              </div>
              <span className="whitespace-nowrap text-xs text-stone-500" data-testid="position-count">
                {n} {n === 1 ? "seat" : "seats"}
              </span>
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.value || "position"} up`} data-focus-id={`${r.key}-up`}>
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </Button>
                <Button variant="secondary" size="sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move ${r.value || "position"} down`} data-focus-id={`${r.key}-down`}>
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.value || "position"}`}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
        {rows.length === 0 ? <li className="text-xs text-stone-500">No positions yet. Add at least one.</li> : null}
      </ul>

      {removedInUse.length > 0 ? (
        <p role="status" data-testid="removed-note" className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
          {removedInUse.map((x) => `${x.title} (${x.n} ${x.n === 1 ? "seat" : "seats"})`).join(", ")}{" "}
          {removedInUse.length === 1 ? "is" : "are"} in use. Removing or renaming a position does not change existing seats: they keep their title and show it as a custom one.
        </p>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="new-position" className="mb-1 block text-xs font-semibold text-charcoal">
            Add a position
          </label>
          <Input
            id="new-position"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Fundraising Chair"
            maxLength={POSITION_MAX}
          />
        </div>
        <Button variant="secondary" onClick={add} disabled={!draft.trim() || rows.length >= POSITIONS_MAX_COUNT}>
          Add
        </Button>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-coral/25 px-3.5 py-2.5 text-xs font-medium text-rose-900">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving..." : "Save positions"}
        </Button>
      </div>
    </div>
  );
}
