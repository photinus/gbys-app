import Link from "next/link";
import { cn } from "@/lib/utils";

/** GBYS geometric emblem (from mockup). */
export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      title="Gold Beach Youth Sports"
      aria-label="Gold Beach Youth Sports"
      className={cn(
        "w-11 h-11 rounded-2xl bg-charcoal text-white flex items-center justify-center shadow-sm hover:scale-105 transition-transform",
        className,
      )}
    >
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 7C5 5.89543 5.89543 5 7 5H17C18.1046 5 19 5.89543 19 7V11.5C19 15.6421 15.6421 19 11.5 19H7C5.89543 19 5 18.1046 5 17V7Z"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <path d="M9 12H14M12 9V15" stroke="#95A9F9" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </Link>
  );
}
