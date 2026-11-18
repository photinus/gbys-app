import type { ReactNode } from "react";
import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <Logo />
          <p className="mt-3 text-sm font-bold tracking-tight">Gold Beach Youth Sports</p>
        </div>
        <div className="rounded-[26px] border border-line/80 bg-white p-6 sm:p-8 shadow-card">{children}</div>
        <p className="mt-6 text-center text-xs text-stone-400">
          Volunteer-run 501(c)(3) in Gold Beach, Oregon.
        </p>
      </div>
    </main>
  );
}
