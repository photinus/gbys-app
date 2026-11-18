import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Org mark: the uploaded logo (`logoUrl`, a plain <img> contained in the rounded square)
 * or the built-in geometric emblem (from the mockup).
 */
export function Logo({
  className,
  href = "/",
  logoUrl,
  name = "Home",
}: {
  className?: string;
  href?: string;
  logoUrl?: string | null;
  /** Organization name, used as the accessible label / tooltip. */
  name?: string;
}) {
  return (
    <Link
      href={href}
      title={name}
      aria-label={name}
      className={cn(
        "w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center overflow-hidden shadow-sm hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/70 focus-visible:ring-offset-2 focus-visible:ring-offset-rail",
        logoUrl ? "bg-white border border-line" : "bg-charcoal text-white",
        className,
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
      ) : (
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5 7C5 5.89543 5.89543 5 7 5H17C18.1046 5 19 5.89543 19 7V11.5C19 15.6421 15.6421 19 11.5 19H7C5.89543 19 5 18.1046 5 17V7Z"
            stroke="currentColor"
            strokeWidth="2.2"
          />
          <path d="M9 12H14M12 9V15" stroke="#95A9F9" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )}
    </Link>
  );
}
