import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

/** Styled checkbox acting as a toggle. Works controlled or uncontrolled (form `name`). */
export function Switch({
  className,
  ref,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { ref?: Ref<HTMLInputElement> }) {
  return (
    <span className={cn("relative inline-flex shrink-0 align-middle", className)}>
      <input ref={ref} type="checkbox" role="switch" className="peer sr-only" {...props} />
      <span
        aria-hidden
        className="block h-6 w-11 rounded-full bg-stone-300 transition-colors peer-checked:bg-charcoal peer-focus-visible:ring-2 peer-focus-visible:ring-periwinkle peer-disabled:opacity-50"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
      />
    </span>
  );
}
