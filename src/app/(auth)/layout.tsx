import type { ReactNode } from "react";
import { connection } from "next/server";
import { Logo } from "@/components/shell/logo";
import { getBranding } from "@/lib/dal/settings";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  await connection(); // branding is runtime-editable; don't prerender it
  const { orgName, legalDesignation, logoUrl } = await getBranding();
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo logoUrl={logoUrl} name={orgName} />
          <p className="mt-3 text-sm font-bold tracking-tight">{orgName}</p>
        </div>
        <div className="rounded-[26px] border border-line/80 bg-white p-6 sm:p-8 shadow-card">{children}</div>
        <p className="mt-6 text-center text-xs text-stone-400">
          Volunteer-run {legalDesignation} in Gold Beach, Oregon.
        </p>
      </div>
    </main>
  );
}
