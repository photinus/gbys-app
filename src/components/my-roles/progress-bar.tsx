import { formatHours } from "@/lib/format";
import { fulfilmentPercent } from "@/lib/volunteer-roles";

/** Expected vs logged hours: solid = verified, light = waiting for approval. */
export function HoursProgress({
  verifiedMinutes,
  pendingMinutes,
  expectedMinutes,
}: {
  verifiedMinutes: number;
  pendingMinutes: number;
  expectedMinutes: number;
}) {
  const pct = fulfilmentPercent(verifiedMinutes, expectedMinutes);
  const verifiedW = expectedMinutes > 0 ? Math.min(100, (verifiedMinutes / expectedMinutes) * 100) : 0;
  const pendingW =
    expectedMinutes > 0 ? Math.min(100 - verifiedW, (pendingMinutes / expectedMinutes) * 100) : 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-semibold text-charcoal">
          {formatHours(verifiedMinutes)} <span className="font-normal text-stone-500">of {formatHours(expectedMinutes)} verified</span>
        </span>
        {pct !== null ? <span className="text-xs font-semibold text-stone-500">{pct}%</span> : null}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(expectedMinutes, 1)}
        aria-valuenow={Math.min(verifiedMinutes, Math.max(expectedMinutes, 1))}
        aria-label="Verified hours compared with expected hours"
        className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-stone-100"
      >
        <div className="h-full bg-emerald-500" style={{ width: `${verifiedW}%` }} />
        <div className="h-full bg-amber-soft" style={{ width: `${pendingW}%` }} />
      </div>
      {pendingMinutes > 0 ? (
        <p className="mt-1 text-xs text-stone-500">
          {formatHours(pendingMinutes)} more waiting for a board member to approve.
        </p>
      ) : null}
    </div>
  );
}
