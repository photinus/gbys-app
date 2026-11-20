import { connection } from "next/server";

/**
 * Program home pages (path route and custom-domain route). Deliberately NOT the GBYS
 * `(public)` chrome: the page component renders its own header (program logo + name,
 * Sign in) because the layout does not know which program is being shown.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  await connection(); // page content and branding are runtime-editable; never prerender
  return <div className="min-h-screen">{children}</div>;
}
