import { cn, initials } from "@/lib/utils";

export function UserAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-periwinkle/35 font-bold text-indigo-950",
        size === "sm" && "h-9 w-9 text-xs",
        size === "md" && "h-11 w-11 text-sm",
        size === "lg" && "h-16 w-16 text-xl"
      )}
    >
      {initials(name)}
    </span>
  );
}
