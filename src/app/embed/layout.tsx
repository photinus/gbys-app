import type { Metadata } from "next";

// Minimal chrome for pages that are iframed on partner sites: no header/footer,
// compact padding, and the app font/background (inherited from the root layout).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-alabaster p-1">{children}</div>;
}
