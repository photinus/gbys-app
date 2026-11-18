import type { Ref, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { fieldControl } from "./input";

export function Textarea({
  className,
  rows = 3,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} rows={rows} className={cn(fieldControl, "resize-y", className)} {...props} />;
}
