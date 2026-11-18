import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

export const fieldControl =
  "w-full px-3.5 py-2 rounded-xl bg-alabaster border border-line text-sm text-charcoal placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-periwinkle disabled:opacity-60 aria-[invalid=true]:border-coral aria-[invalid=true]:ring-coral/40";

export function Input({
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(fieldControl, className)} {...props} />;
}
