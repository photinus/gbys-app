import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-1 rounded-2xl border border-dashed border-line bg-alabaster/50 px-6 py-10",
        className,
      )}
    >
      <p className="text-sm font-semibold text-charcoal">{title}</p>
      {description ? <p className="text-xs text-stone-500 max-w-sm">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
