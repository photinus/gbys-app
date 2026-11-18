import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PastelTone = "lavender" | "peach" | "mint";

const tones: Record<PastelTone, string> = {
  lavender: "bg-lavender-card border-indigo-200/40",
  peach: "bg-peach-card border-orange-200/40",
  mint: "bg-mint-card border-emerald-200/50",
};

export function PastelCard({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: PastelTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[20px] p-4 border transition-transform hover:-translate-y-0.5",
        tones[tone],
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-[15px] text-charcoal">{title}</h3>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="text-xs text-stone-600 mt-1.5 leading-relaxed">{children}</div> : null}
    </div>
  );
}
