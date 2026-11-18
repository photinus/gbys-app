import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PastelCard, type PastelTone } from "@/components/ui/pastel-card";

/**
 * The whole card is one link (no nested interactive elements). The arrow is
 * decorative; the accessible name comes from aria-label.
 */
export function QuickLinkCard({
  href,
  tone,
  title,
  children,
}: {
  href: string;
  tone: PastelTone;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={title}
      className="group block h-full rounded-[20px] outline-none focus-visible:ring-2 focus-visible:ring-periwinkle focus-visible:ring-offset-2"
    >
      <PastelCard
        tone={tone}
        title={title}
        action={<ArrowRight aria-hidden className="h-4 w-4 text-stone-600 transition-transform group-hover:translate-x-0.5" />}
        className="h-full group-focus-visible:-translate-y-0.5"
      >
        {children}
      </PastelCard>
    </Link>
  );
}
