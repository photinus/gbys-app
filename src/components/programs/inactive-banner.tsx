import { Badge } from "@/components/ui/badge";

/** Shown to board users on pages of a program that is switched off (isActive=false). */
export function InactiveProgramBanner({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      data-testid="inactive-program-banner"
      className={`flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden ${className}`}
    >
      <Badge tone="warning">Inactive program</Badge>
      <span>Hidden from public registration and dropdowns. Only the board can open it.</span>
    </div>
  );
}
