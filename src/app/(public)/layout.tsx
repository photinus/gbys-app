import Link from "next/link";
import { connection } from "next/server";
import { Logo } from "@/components/shell/logo";
import { SignInLink } from "@/components/shell/sign-in-link";
import { getBranding } from "@/lib/dal/settings";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  await connection(); // branding is runtime-editable; don't prerender it
  const { orgName, legalDesignation, logoUrl } = await getBranding();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <Logo logoUrl={logoUrl} name={orgName} />
          <span className="hidden text-sm font-bold tracking-tight sm:inline">{orgName}</span>
        </div>
        <SignInLink />
      </header>
      <div className="flex-1">{children}</div>
      <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-xs text-stone-400 sm:px-8">
        {orgName} is a volunteer-run {legalDesignation} in Gold Beach, Oregon.
      </footer>
    </div>
  );
}
