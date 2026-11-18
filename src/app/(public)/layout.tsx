import Link from "next/link";
import { Logo } from "@/components/shell/logo";
import { buttonStyles } from "@/components/ui/button";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden text-sm font-bold tracking-tight sm:inline">Gold Beach Youth Sports</span>
        </div>
        <Link href="/sign-in" className={buttonStyles({ variant: "secondary" })}>
          Sign in
        </Link>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-xs text-stone-400 sm:px-8">
        Gold Beach Youth Sports is a volunteer-run 501(c)(3) in Gold Beach, Oregon.
      </footer>
    </div>
  );
}
