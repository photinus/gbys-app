"use client";

import { useTransition } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from "@/components/ui";
import { removeGuardianAction } from "@/app/(portal)/household/actions";
import type { GuardianRow } from "@/lib/dal/households";
import { initials } from "@/lib/utils";

export function GuardianList({ guardians }: { guardians: GuardianRow[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  // Group by athlete, preserving the DAL's ordering.
  const groups = new Map<string, { name: string; rows: GuardianRow[] }>();
  for (const g of guardians) {
    const grp = groups.get(g.athleteId) ?? { name: g.athleteName, rows: [] };
    grp.rows.push(g);
    groups.set(g.athleteId, grp);
  }

  function remove(g: GuardianRow) {
    const msg = g.isMe
      ? `Remove yourself as a guardian of ${g.athleteName}? You will lose access to this athlete.`
      : `Remove ${g.name} as a guardian of ${g.athleteName}?`;
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      const res = await removeGuardianAction(g.athleteId, g.userId);
      if (res.ok) toast.success(g.isMe ? "You were removed" : "Guardian removed");
      else toast.error("Could not remove guardian", res.error);
    });
  }

  return (
    <Card>
      <CardHeader title="Guardians" description="Adults who can act for each athlete in your household." />
      {groups.size === 0 ? (
        <EmptyState title="No guardians to show" description="Add an athlete to get started." />
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([athleteId, grp]) => {
            const me = grp.rows.find((r) => r.isMe);
            return (
              <section key={athleteId}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">{grp.name}</h3>
                <ul className="divide-y divide-line-soft">
                  {grp.rows.map((g) => {
                    const isLast = grp.rows.length <= 1;
                    const canRemove = !isLast && (g.isMe || !!me?.canRegister);
                    return (
                      <li key={g.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage/35 text-xs font-bold text-emerald-900">
                            {initials(g.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-charcoal">
                              {g.name} {g.isMe ? <span className="font-normal text-stone-400">(you)</span> : null}
                            </p>
                            <p className="truncate text-xs text-stone-500">
                              {g.relationship} - {g.email}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {g.canRegister ? <Badge tone="info">Manages</Badge> : <Badge>View only</Badge>}
                          {g.canSignWaivers ? <Badge tone="success">Waivers</Badge> : null}
                          {canRemove ? (
                            <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(g)}>
                              {g.isMe ? "Leave" : "Remove"}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
