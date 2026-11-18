import { createElement, isValidElement, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KpiTone = "periwinkle" | "sage" | "coral" | "amber";

const tones: Record<KpiTone, string> = {
  periwinkle: "bg-periwinkle/30 text-indigo-700",
  sage: "bg-sage/35 text-emerald-800",
  coral: "bg-coral/30 text-rose-700",
  amber: "bg-amber-soft/35 text-amber-800",
};

type IconProp = ReactNode | ComponentType<{ className?: string }>;

function renderIcon(icon: IconProp): ReactNode {
  if (isValidElement(icon) || typeof icon === "string" || typeof icon === "number") return icon;
  if (icon && (typeof icon === "function" || typeof icon === "object")) {
    return createElement(icon as ComponentType<{ className?: string }>, { className: "w-5 h-5" });
  }
  return null;
}

export function KpiCard({
  icon,
  label,
  value,
  delta,
  hint,
  tone = "periwinkle",
  className,
}: {
  /** A rendered element (e.g. `<Users className="w-5 h-5" />`) or a lucide component. */
  icon: IconProp;
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  hint?: ReactNode;
  tone?: KpiTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-white rounded-[24px] p-5 border border-line/80 shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-md transition-shadow",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", tones[tone])}>
          {renderIcon(icon)}
        </div>
        <span className="text-sm font-medium text-stone-600">{label}</span>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-2.5">
        <span className="text-3xl font-bold tracking-tight text-charcoal">{value}</span>
        {delta ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-sage/35 text-emerald-800">
            {delta}
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-stone-400 mt-1.5">{hint}</p> : null}
    </div>
  );
}
