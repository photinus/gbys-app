import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactFormEditor } from "@/components/contact-admin/form-editor";
import { contactEmbedConfig } from "@/components/contact-admin/embed-config";
import { DalError, requireSession } from "@/lib/dal/context";
import { getProgramForContact } from "@/lib/dal/contact-forms";

export const metadata: Metadata = { title: "New contact form" };

export default async function ProgramNewContactFormPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireSession(`/programs/${slug}/contact/forms/new`);
  let program;
  try {
    program = await getProgramForContact(ctx, slug);
  } catch (e) {
    if (e instanceof DalError) notFound();
    throw e;
  }
  const base = `/programs/${program.slug}/contact`;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Link href={`${base}/forms`} className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          {program.name} contact forms
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">New contact form</h1>
      </div>
      <ContactFormEditor basePath={base} program={{ id: program.id, name: program.name }} {...contactEmbedConfig()} />
    </div>
  );
}
