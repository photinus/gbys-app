import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/60 disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-charcoal text-white hover:bg-stone-800 shadow-sm",
  secondary: "bg-white border border-line text-charcoal hover:bg-stone-50 shadow-sm",
  ghost: "bg-transparent text-stone-600 hover:bg-alabaster hover:text-charcoal",
  danger: "bg-coral/40 text-rose-950 hover:bg-coral/60",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3.5 py-2 text-xs",
  md: "px-4 py-2.5 text-sm",
};

/** Class string for button styling; use on <Link> / <a> to get a button look. */
export function buttonStyles({
  variant = "primary",
  size = "md",
  pill = true,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
  className?: string;
} = {}) {
  return cn(base, variants[variant], sizes[size], pill ? "rounded-full" : "rounded-xl", className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "primary",
  size = "md",
  pill = true,
  type = "button",
  className,
  ref,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonStyles({ variant, size, pill, className })}
      {...props}
    />
  );
}
