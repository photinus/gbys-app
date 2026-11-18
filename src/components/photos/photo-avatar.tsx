import { cn, initials } from "@/lib/utils";

const SIZES = {
  xs: "h-8 w-8 text-[10px]",
  sm: "h-10 w-10 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-24 w-24 text-2xl",
} as const;

/** Round photo with an initials fallback. Photos come from access-checked /media routes. */
export function PhotoAvatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-periwinkle/35 font-bold text-indigo-950",
        SIZES[size],
        className
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
