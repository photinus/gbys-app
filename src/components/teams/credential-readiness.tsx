import { Badge } from "@/components/ui/badge";
import type { StaffReadiness } from "@/lib/dal/teams";
import { formatDate } from "@/lib/format";

const STATE_LABEL = { ok: "Verified", expired: "Expired", pending: "Pending review", rejected: "Rejected", missing: "Missing" } as const;

/** Compact "credentials ready / n gaps" summary with the gap list. */
export function CredentialReadiness({ readiness }: { readiness: StaffReadiness | null }) {
  if (!readiness) return null;
  if (readiness.items.length === 0) return <span className="text-xs text-stone-400">No credentials required</span>;
  const gaps = readiness.items.filter((i) => i.state !== "ok");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {readiness.ready ? (
        <Badge tone="success">Credentials ready</Badge>
      ) : (
        <Badge tone="warning">
          {gaps.length} credential gap{gaps.length === 1 ? "" : "s"}
        </Badge>
      )}
      {gaps.map((g) => (
        <span key={g.definitionId} className="text-xs text-stone-500">
          {g.name}: {STATE_LABEL[g.state]}
          {g.state === "expired" && g.expiresAt ? ` ${formatDate(g.expiresAt)}` : ""}
        </span>
      ))}
    </div>
  );
}
