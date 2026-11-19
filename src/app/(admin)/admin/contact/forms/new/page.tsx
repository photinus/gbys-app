import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContactFormEditor } from "@/components/contact-admin/form-editor";
import { contactEmbedConfig } from "@/components/contact-admin/embed-config";
import { isBoard, requireSession } from "@/lib/dal/context";
import { listActivePrograms } from "@/lib/dal/programs";

export const metadata: Metadata = { title: "New contact form" };

export default async function AdminNewContactFormPage() {
  const ctx = await requireSession("/admin/contact/forms/new");
  if (!isBoard(ctx)) notFound();
  const programs = await listActivePrograms(ctx);
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <Link href="/admin/contact/forms" className="text-xs font-semibold text-stone-500 hover:text-charcoal">
          Contact forms
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-charcoal">New contact form</h1>
      </div>
      <ContactFormEditor basePath="/admin/contact" programOptions={programs.map((p) => ({ id: p.id, name: p.name }))} {...contactEmbedConfig()} />
    </div>
  );
}
