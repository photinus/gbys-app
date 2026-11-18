import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { CredentialTypesPanel } from "@/components/settings/credential-types-panel";
import { isBoard, requireSession } from "@/lib/dal/context";
import { listCredentialTypesAdmin } from "@/lib/dal/credential-types";

export const metadata: Metadata = { title: "Credential types" };
export const dynamic = "force-dynamic";

export default async function CredentialTypesPage() {
  const ctx = await requireSession("/admin/settings/credentials");
  if (!isBoard(ctx)) notFound();
  const rows = await listCredentialTypesAdmin(ctx);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/settings" className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal">
          <ArrowLeft className="h-3.5 w-3.5" /> Settings
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Credential types</h1>
        <p className="mt-1 text-sm text-stone-500">
          What volunteers can submit for verification. Codes are permanent and types are archived, never deleted.
        </p>
      </div>
      <Card>
        <CardHeader
          title="All credential types"
          description="Archived types are hidden from new submissions but stay on existing credentials"
        />
        <CredentialTypesPanel rows={rows} />
      </Card>
    </div>
  );
}
