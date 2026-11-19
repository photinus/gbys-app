"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchDonorsAction } from "@/app/(portal)/finance/donations/actions";
import { Input } from "@/components/ui";

export interface PickedDonor {
  id: string;
  name: string;
  email: string | null;
}

/** Type-ahead donor search. Submits the chosen id as `donorContactId`. */
export function DonorPicker({ initial }: { initial: PickedDonor | null }) {
  const [picked, setPicked] = useState<PickedDonor | null>(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedDonor[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const h = setTimeout(async () => {
      setSearching(true);
      const res = await searchDonorsAction(term);
      if (mine === seq.current) {
        setResults(res.ok ? res.data : []);
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  if (picked) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-alabaster px-3.5 py-2.5 text-sm" data-testid="donor-picked">
        <input type="hidden" name="donorContactId" value={picked.id} />
        <span className="min-w-0 truncate">
          <strong>{picked.name}</strong>
          {picked.email ? <span className="ml-2 text-xs text-stone-500">{picked.email}</span> : <span className="ml-2 text-xs text-amber-800">no email on file</span>}
        </span>
        <button
          type="button"
          onClick={() => {
            setPicked(null);
            setQ("");
          }}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-stone-500 hover:text-charcoal"
        >
          <X className="h-3.5 w-3.5" /> Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input type="hidden" name="donorContactId" value="" />
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or email"
        className="pl-10"
        autoComplete="off"
        aria-label="Search donors"
        data-testid="donor-search"
      />
      {q.trim().length >= 2 ? (
        <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-line bg-white text-sm shadow-card" data-testid="donor-results">
          {results.length === 0 ? (
            <li className="px-3.5 py-2.5 text-xs text-stone-500">{searching ? "Searching…" : "No one found. Choose “New donor” above to add them."}</li>
          ) : (
            results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setPicked(r)} className="flex w-full flex-col px-3.5 py-2 text-left hover:bg-alabaster">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-xs text-stone-500">{r.email ?? "no email on file"}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
