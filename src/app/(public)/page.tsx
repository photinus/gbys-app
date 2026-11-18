import { CalendarCheck, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { PastelCard } from "@/components/ui/pastel-card";

export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-8 pt-6 sm:px-8 sm:pt-12">
      <section className="max-w-2xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100/80 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Volunteer-run since day one
        </span>
        <h1 className="mt-5 text-4xl font-bold tracking-tight text-charcoal sm:text-5xl">
          One home for Gold Beach youth sports.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-stone-600">
          Manage your household and athletes, keep volunteer clearances and certifications in one secure place, and
          stay in sync with GBYS programs and partner leagues.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <Link href="/sign-in" className={buttonStyles({ size: "md" })}>
            Sign in
          </Link>
          <a href="#how-it-works" className={buttonStyles({ variant: "secondary" })}>
            How it works
          </a>
        </div>
      </section>

      <section id="how-it-works" className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
        <PastelCard tone="lavender" title="Household and athletes">
          <Users className="mb-3 h-5 w-5 text-indigo-600" aria-hidden />
          Add your kids once, share access with co-guardians, and keep emergency contacts and medical notes protected
          and audited.
        </PastelCard>
        <PastelCard tone="peach" title="Volunteer credentials">
          <ShieldCheck className="mb-3 h-5 w-5 text-amber-700" aria-hidden />
          Upload proof of background checks, SafeSport and concussion training. The board verifies; you get notified.
        </PastelCard>
        <PastelCard tone="mint" title="Programs and seasons">
          <CalendarCheck className="mb-3 h-5 w-5 text-emerald-700" aria-hidden />
          Registration, schedules and facilities for GBYS clinics and our independent partner leagues are on the way.
        </PastelCard>
      </section>
    </main>
  );
}
