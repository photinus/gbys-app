import { formatHours } from "@/lib/format";
import { fulfilmentPercent } from "@/lib/volunteer-roles";

/** Expected vs logged hours: verified (solid) and self-reported pending (light). */
export function ProgressBar({
  verifiedMinutes,
  pendingMinutes,
  expectedMinutes,
}: {
  verifiedMinutes: number;
  pendingMinutes: number;
  expectedMinutes: number;
}) {
  const pct = fulfilmentPercent(verifiedMinutes, expectedMinutes);
  const w = (m: number) => (expectedMinutes > 0 ? Math.min(100, (m / expectedMinutes) * 100) : 0);
  const verifiedW = w(verifiedMinutes);
  const pendingW = Math.min(100 - verifiedW, w(pendingMinutes));
  return (
    <div className="min-w-0">
      <div
        role="progressbar"
        aria-label="Verified hours against expected"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, pct ?? 0)}
        className="flex h-2 w-full overflow-hidden rounded-full bg-stone-100"
      >
        <div className="h-full bg-emerald-600" style={{ width: `${verifiedW}%` }} />
        <div className="h-full bg-amber-soft" style={{ width: `${pendingW}%` }} />
      </div>
      <p className="mt-1 text-xs text-stone-500">
        {formatHours(verifiedMinutes)} verified of {formatHours(expectedMinutes)}
        {pct !== null ? ` (${pct}%)` : ""}
        {pendingMinutes > 0 ? ` · ${formatHours(pendingMinutes)} awaiting approval` : ""}
      </p>
    </div>
  );
}
