import { cn } from "@/lib/utils";

export const DEFAULT_TEAM_COLOR = "#95A9F9";

/** Small round swatch for a team's calendar color. */
export function TeamColorDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10", className)}
      style={{ backgroundColor: color ?? DEFAULT_TEAM_COLOR }}
    />
  );
}
