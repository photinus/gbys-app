import Link from "next/link";
import { connection } from "next/server";
import { buttonStyles } from "@/components/ui/button";
import { Logo } from "@/components/shell/logo";
import { getBranding } from "@/lib/dal/settings";

export default async function NotFound() {
  await connection(); // branding is runtime-editable; don't prerender it
  const { orgName, logoUrl } = await getBranding();
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-[26px] border border-line/80 bg-white p-8 text-center shadow-card">
        <Logo className="mx-auto mb-6" logoUrl={logoUrl} name={orgName} />
        <p className="text-xs font-bold uppercase tracking-wider text-stone-400">404</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-stone-500">
          We couldn&apos;t find what you were looking for. It may have moved, or you may not have access.
        </p>
        <Link href="/" className={buttonStyles({ className: "mt-6" })}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
