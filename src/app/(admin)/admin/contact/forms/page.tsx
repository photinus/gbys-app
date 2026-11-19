import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormsView } from "@/components/contact-admin/views";
import { isBoard, requireSession } from "@/lib/dal/context";

export const metadata: Metadata = { title: "Contact forms" };
export const dynamic = "force-dynamic";

export default async function AdminContactFormsPage() {
  const ctx = await requireSession("/admin/contact/forms");
  if (!isBoard(ctx)) notFound();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Contact forms</h1>
        <p className="mt-1 text-sm text-stone-500">Org-wide forms are managed by the board. Program admins manage their own program&apos;s forms.</p>
      </div>
      <FormsView ctx={ctx} scope={{ all: true }} basePath="/admin/contact" />
    </div>
  );
}
