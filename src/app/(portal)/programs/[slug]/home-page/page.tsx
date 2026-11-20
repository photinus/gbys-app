import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AddressForm, DomainForm } from "@/components/program-site-editor/address-card";
import { ContentForm } from "@/components/program-site-editor/content-form";
import { AccentForm, ImageUploader } from "@/components/program-site-editor/look-card";
import { SectionsEditor } from "@/components/program-site-editor/sections-editor";
import { StatusCard } from "@/components/program-site-editor/status-card";
import { InactiveProgramBanner } from "@/components/programs/inactive-banner";
import { Card, CardHeader } from "@/components/ui";
import { DalError, requireSession } from "@/lib/dal/context";
import { getSiteEditor } from "@/lib/dal/program-sites-admin";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Home page" };

const nav = [
  ["status", "Status"],
  ["content", "Content"],
  ["look", "Look"],
  ["blocks", "Blocks"],
  ["address", "Address"],
] as const;

export default async function ProgramHomePageEditor({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession(`/programs/${slug}/home-page`);
  let d;
  try {
    d = await getSiteEditor(ctx, slug);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const id = d.program.id;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link href={`/programs/${d.program.slug}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {d.program.name}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">Home page</h1>
        <p className="mt-1 text-sm text-stone-500">
          A public page for {d.program.name} that you can share with families. Each section below saves on its own.
          {d.updatedAt ? (
            <>
              {" "}
              Last edited {formatDateTime(d.updatedAt)}
              {d.updatedByName ? ` by ${d.updatedByName}` : ""}.
            </>
          ) : null}
        </p>
        <nav aria-label="Jump to a section" className="mt-3 flex flex-wrap gap-2">
          {nav.map(([a, label]) => (
            <a key={a} href={`#${a}`} className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-stone-600 ring-1 ring-line hover:text-charcoal">
              {label}
            </a>
          ))}
        </nav>
      </div>

      {!d.program.isActive ? <InactiveProgramBanner /> : null}

      <Card id="status" className="scroll-mt-20">
        <CardHeader title="Status" description="Publish when you're ready. You can preview first." />
        <StatusCard
          programId={id}
          programSlug={d.program.slug}
          isPublished={d.isPublished}
          pathSlug={d.pathSlug}
          customDomain={d.customDomain}
          appOrigin={d.appOrigin}
        />
      </Card>

      <Card id="content" className="scroll-mt-20">
        <CardHeader title="Content" description="The words on your page" />
        <ContentForm
          programId={id}
          programName={d.program.name}
          values={{
            headline: d.headline,
            tagline: d.tagline,
            about: d.about,
            showOpenRegistrations: d.showOpenRegistrations,
            contactEmail: d.contactEmail,
            contactPhone: d.contactPhone,
            contactFormId: d.contactFormId,
            seoDescription: d.seoDescription,
          }}
          contactForms={d.contactForms}
        />
      </Card>

      <Card id="look" className="scroll-mt-20">
        <CardHeader title="Look" description="Color, big banner photo and logo" />
        <div className="space-y-8">
          <AccentForm programId={id} accentColor={d.accentColor} />
          <hr className="border-line-soft" />
          <ImageUploader
            programId={id}
            kind="hero"
            title="Banner photo"
            help="Shown behind the headline at the top. Wide photos work best. PNG, JPEG or WebP up to 5 MB; it's resized to at most 1920 px wide."
            initialUrl={d.heroImageUrl}
          />
          <hr className="border-line-soft" />
          <ImageUploader
            programId={id}
            kind="logo"
            title="Logo"
            help="Shown next to the program name. A square or wide logo on a transparent background works well. PNG, JPEG or WebP up to 5 MB; it's resized to at most 512 px."
            initialUrl={d.logoUrl}
          />
        </div>
      </Card>

      <Card id="blocks" className="scroll-mt-20">
        <CardHeader title="Page blocks" description="Extra sections below your About text, shown in this order" />
        <SectionsEditor programId={id} sections={d.sections} />
      </Card>

      <Card id="address" className="scroll-mt-20">
        <CardHeader title="Address & visibility" description="Where people find the page, and whether GBYS promotes it" />
        <div className="space-y-8">
          <AddressForm programId={id} appHost={d.appHost} pathSlug={d.pathSlug} listOnMainSite={d.listOnMainSite} />
          <hr className="border-line-soft" />
          <DomainForm programId={id} appHost={d.appHost} customDomain={d.customDomain} canSetDomain={d.canSetDomain} />
        </div>
      </Card>
    </div>
  );
}
