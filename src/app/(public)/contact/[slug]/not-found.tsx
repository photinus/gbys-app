import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function ContactNotFound() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-10 pt-4 sm:px-8 sm:pt-8">
      <div className="rounded-[26px] border border-line/80 bg-white p-8 text-center shadow-card">
        <h1 className="text-2xl font-bold tracking-tight text-charcoal">This form isn&apos;t available</h1>
        <p className="mt-2 text-sm text-stone-500">The link may be old, or the form is no longer accepting messages.</p>
        <Link href="/" className={buttonStyles({ className: "mt-6" })}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
