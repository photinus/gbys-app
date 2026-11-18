import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

/**
 * Label + control + hint/error wrapper. If `children` is a single element
 * (Input/Select/Textarea) it receives `id`, `aria-invalid` and `aria-describedby`.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const reactId = useId();
  let controlId = reactId;
  let control = children;
  const describedBy = error ? `${reactId}-error` : hint ? `${reactId}-hint` : undefined;

  if (isValidElement(children)) {
    const el = children as ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
    controlId = el.props.id ?? reactId;
    control = cloneElement(el, {
      id: controlId,
      "aria-invalid": error ? true : el.props["aria-invalid"],
      "aria-describedby": describedBy ?? el.props["aria-describedby"],
    });
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={controlId}>{label}</Label>
      {control}
      {error ? (
        <p id={`${reactId}-error`} role="alert" className="mt-1 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${reactId}-hint`} className="mt-1 text-xs text-stone-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
