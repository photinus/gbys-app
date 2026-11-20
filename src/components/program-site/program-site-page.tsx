import { ArrowRight, ExternalLink, Mail, MessageSquare, Phone } from "lucide-react";
import type { CSSProperties } from "react";
import { OpenSeasonCard } from "@/components/registration/open-season-card";
import { SiteText } from "@/components/program-site/site-text";
import type { PublicProgramSite } from "@/lib/dal/program-sites";
import type { OpenSeason } from "@/lib/dal/registrations";
import { contrastRatio, ON_DARK, readableTextOn } from "@/lib/color";
import { isSafeHref } from "@/lib/site-text";
import { cn, initials } from "@/lib/utils";

/**
 * The themed public program home page. Pure presentation: the route decides what to load.
 *  - `origin`: "" renders relative links (app domain, preview); a custom domain passes
 *    primaryOrigin() so Register / Sign in / Contact / org links point at the app.
 *  - `preview`: banner + no site chrome (the portal shell already provides it).
 */
export function ProgramSitePage({
  site,
  seasons,
  origin = "",
  preview = false,
  orgName,
  editorHref,
}: {
  site: PublicProgramSite;
  seasons: OpenSeason[];
  origin?: string;
  preview?: boolean;
  orgName: string;
  editorHref?: string;
}) {
  const accent = site.accentColor;
  const onAccent = readableTextOn(accent);
  // Accent used as TEXT/links on white: fall back to near-black when the accent is too light.
  const linkColor = contrastRatio(accent, ON_DARK) >= 4.5 ? accent : "#111827";
  const hasHero = !!site.heroImageUrl;
  const darkOnAccent = onAccent !== ON_DARK;
  const gradientEnd = darkOnAccent
    ? `color-mix(in srgb, ${accent} 65%, white)`
    : `color-mix(in srgb, ${accent} 60%, black)`;
  const themeVars = {
    "--site-accent": accent,
    "--site-on-accent": onAccent,
    "--site-link": linkColor,
  } as CSSProperties;

  const registerOpen = site.showOpenRegistrations && seasons.length > 0;
  const signInHref = `${origin}/sign-in`;
  const contactFormHref = site.contactForm ? `${origin}/contact/${site.contactForm.slug}` : null;
  const phoneHref = site.contactPhone ? `tel:${site.contactPhone.replace(/[^\d+]/g, "")}` : null;
  const hasContact = !!(site.contactEmail || site.contactPhone || contactFormHref);
  const sections = site.sections.filter((s) => s.title || ("body" in s ? s.body : s.items.length > 0));

  return (
    <div
      style={themeVars}
      className={cn("program-site flex min-h-screen flex-col", preview && "min-h-0")}
    >
      {/* Theme hooks: accent for buttons inside shared components, readable link colour. */}
      <style>{`
        .program-site .site-link{color:var(--site-link)}
        .program-site a[aria-label^="Register for"]{background-color:var(--site-accent);color:var(--site-on-accent)}
        .program-site a[aria-label^="Register for"]:hover{background-color:var(--site-accent);filter:brightness(.92)}
        .program-site :focus-visible{outline:2px solid var(--site-link);outline-offset:2px}
        .program-site summary::-webkit-details-marker{display:none}
      `}</style>

      {preview ? (
        <div
          role="status"
          data-testid="site-preview-banner"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="font-semibold">
            {site.isPublished ? "Preview — this is your live page" : "Preview — not published"}
          </span>
          {editorHref ? (
            <a href={editorHref} className="font-semibold underline underline-offset-2">
              Back to editor
            </a>
          ) : null}
        </div>
      ) : (
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {site.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={site.logoUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded-2xl border border-line bg-white object-contain p-0.5"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold"
                style={{ backgroundColor: accent, color: onAccent }}
              >
                {initials(site.program.name)}
              </span>
            )}
            <span className="min-w-0 truncate text-sm font-bold tracking-tight text-charcoal">{site.program.name}</span>
          </div>
          <a
            href={signInHref}
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-white px-4 py-2.5 text-sm font-semibold text-charcoal shadow-sm hover:bg-stone-50"
          >
            Sign in
          </a>
        </header>
      )}

      <main className={cn("mx-auto w-full flex-1", preview ? "" : "max-w-5xl px-4 pb-10 sm:px-8")}>
        {/* Hero */}
        <section
          aria-labelledby="site-headline"
          data-testid="site-hero"
          className="relative overflow-hidden rounded-[28px] shadow-card"
          style={
            hasHero
              ? { backgroundColor: "#1c1c1e" }
              : { backgroundImage: `linear-gradient(135deg, ${accent}, ${gradientEnd})`, color: onAccent }
          }
        >
          {hasHero ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={site.heroImageUrl!}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                fetchPriority="high"
              />
              <div
                aria-hidden
                className="absolute inset-0"
                style={{ backgroundImage: "linear-gradient(180deg, rgba(0,0,0,.45), rgba(0,0,0,.72))" }}
              />
            </>
          ) : null}
          <div
            className={cn(
              "relative px-6 py-14 sm:px-12 sm:py-20",
              hasHero ? "text-white" : "",
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider opacity-90">{site.program.sport}</p>
            <h1
              id="site-headline"
              className="mt-2 max-w-3xl break-words text-3xl font-bold tracking-tight sm:text-5xl"
            >
              {site.headline}
            </h1>
            {site.tagline ? (
              <p className="mt-4 max-w-2xl break-words text-base leading-relaxed opacity-95 sm:text-lg">{site.tagline}</p>
            ) : null}
            {site.showOpenRegistrations ? (
              <div className="mt-8">
                {registerOpen ? (
                  <a
                    href="#open-registrations"
                    data-testid="site-cta"
                    className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold shadow-sm hover:brightness-95"
                    style={
                      hasHero
                        ? { backgroundColor: accent, color: onAccent }
                        : { backgroundColor: onAccent, color: accent }
                    }
                  >
                    Register <ArrowRight className="h-4 w-4" aria-hidden />
                  </a>
                ) : (
                  <span
                    data-testid="site-cta-none"
                    className="inline-flex items-center rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-charcoal"
                  >
                    No open registrations right now
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </section>

        <div className="mt-10 space-y-12">
          {site.about?.trim() ? (
            <section aria-labelledby="site-about">
              <h2 id="site-about" className="text-2xl font-bold tracking-tight text-charcoal">
                About
              </h2>
              <AccentRule accent={accent} />
              <SiteText text={site.about} className="max-w-3xl" />
            </section>
          ) : null}

          {site.showOpenRegistrations ? (
            <section id="open-registrations" aria-labelledby="site-registrations" className="scroll-mt-6">
              <h2 id="site-registrations" className="text-2xl font-bold tracking-tight text-charcoal">
                Open registrations
              </h2>
              <AccentRule accent={accent} />
              {seasons.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-white/60 px-6 py-10 text-center">
                  <p className="text-sm font-semibold text-charcoal">No registrations are open right now</p>
                  <p className="mt-1 text-xs text-stone-500">New seasons are posted here as soon as they open.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {seasons.map((s) => (
                    <OpenSeasonCard
                      key={s.seasonId}
                      season={s}
                      registerHref={`${origin}/register/${s.program.slug}`}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {sections.map((s) => (
            <section key={s.id} aria-labelledby={`site-s-${s.id}`}>
              {s.title ? (
                <>
                  <h2 id={`site-s-${s.id}`} className="break-words text-2xl font-bold tracking-tight text-charcoal">
                    {s.title}
                  </h2>
                  <AccentRule accent={accent} />
                </>
              ) : null}
              {s.kind === "text" ? <SiteText text={s.body} className="max-w-3xl" /> : null}
              {s.kind === "faq" ? (
                <div className="max-w-3xl space-y-2.5">
                  {s.items.map((it, i) => (
                    <details key={i} className="group rounded-2xl border border-line/80 bg-white p-4 shadow-card">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 break-words text-[15px] font-semibold text-charcoal">
                        <span className="min-w-0">{it.q}</span>
                        <span
                          aria-hidden
                          className="mt-0.5 shrink-0 text-lg leading-none transition-transform group-open:rotate-45"
                          style={{ color: linkColor }}
                        >
                          +
                        </span>
                      </summary>
                      <SiteText text={it.a} className="mt-3" />
                    </details>
                  ))}
                </div>
              ) : null}
              {s.kind === "links" ? (
                <ul className="grid max-w-3xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {s.items
                    .filter((it) => isSafeHref(it.url))
                    .map((it, i) => (
                      <li key={i}>
                        <a
                          href={it.url}
                          rel="noopener noreferrer nofollow"
                          {...(it.url.toLowerCase().startsWith("http") ? { target: "_blank" } : {})}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-line/80 bg-white px-4 py-3 text-sm font-semibold text-charcoal shadow-card hover:bg-stone-50"
                        >
                          <span className="min-w-0 break-words">{it.label}</span>
                          <ExternalLink className="h-4 w-4 shrink-0" style={{ color: linkColor }} aria-hidden />
                        </a>
                      </li>
                    ))}
                </ul>
              ) : null}
            </section>
          ))}

          {hasContact ? (
            <section aria-labelledby="site-contact">
              <h2 id="site-contact" className="text-2xl font-bold tracking-tight text-charcoal">
                Contact
              </h2>
              <AccentRule accent={accent} />
              <div className="flex max-w-3xl flex-col gap-3 rounded-[26px] border border-line/80 bg-white p-5 shadow-card sm:p-6">
                {site.contactEmail ? (
                  <a href={`mailto:${site.contactEmail}`} className="site-link flex items-center gap-2.5 break-all text-sm font-medium">
                    <Mail className="h-4 w-4 shrink-0" aria-hidden /> {site.contactEmail}
                  </a>
                ) : null}
                {site.contactPhone && phoneHref ? (
                  <a href={phoneHref} className="site-link flex items-center gap-2.5 text-sm font-medium">
                    <Phone className="h-4 w-4 shrink-0" aria-hidden /> {site.contactPhone}
                  </a>
                ) : null}
                {contactFormHref ? (
                  <div>
                    <a
                      href={contactFormHref}
                      className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm hover:brightness-95"
                      style={{ backgroundColor: accent, color: onAccent }}
                    >
                      <MessageSquare className="h-4 w-4" aria-hidden /> {site.contactForm?.title ?? "Contact us"}
                    </a>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </main>

      {preview ? null : (
        <footer className="mx-auto w-full max-w-5xl px-4 py-8 text-xs text-stone-500 sm:px-8">
          <a href={`${origin}/`} className="font-semibold text-stone-600 underline underline-offset-2 hover:text-charcoal">
            Part of Gold Beach Youth Sports
          </a>
          {orgName && orgName !== "Gold Beach Youth Sports" ? <span> · {orgName}</span> : null}
        </footer>
      )}
    </div>
  );
}

function AccentRule({ accent }: { accent: string }) {
  return <div aria-hidden className="mb-4 mt-2 h-1 w-10 rounded-full" style={{ backgroundColor: accent }} />;
}
