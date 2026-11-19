import { formatCents } from "@/lib/format";
import type { FeePreviewRow } from "@/lib/dal/stripe-connect";

/** Worked example(s) of the platform fee, from the server-computed preview rows. */
export function FeePreview({ rows }: { rows: FeePreviewRow[] }) {
  return (
    <ul className="space-y-1.5 text-sm text-stone-700" data-testid="fee-preview">
      {rows.map((r) => (
        <li key={`${r.label}-${r.feeCents}`}>
          On a <span className="font-semibold text-charcoal">{formatCents(r.feeCents)}</span> registration
          {r.label !== "Example registration" ? <span className="text-stone-500"> ({r.label})</span> : null} GBYS keeps{" "}
          <span className="font-semibold text-charcoal">{formatCents(r.platformFeeCents)}</span>; your league receives{" "}
          <span className="font-semibold text-charcoal">{formatCents(r.leagueReceivesCents)}</span> before Stripe&apos;s processing fee.
        </li>
      ))}
    </ul>
  );
}
