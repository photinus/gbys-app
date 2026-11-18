import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { ProgramEditForm } from "@/components/programs/program-edit-form";
import { ProgramRolesPanel } from "@/components/programs/program-roles-panel";
import { DalError, isBoard, requireSession } from "@/lib/dal/context";
import { getProgramAdmin, listCredentialOptions, listProgramRoles } from "@/lib/dal/programs";

export const metadata: Metadata = { title: "Program" };

export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(`/admin/programs/${id}`);
  if (!isBoard(ctx)) notFound();

  let program;
  try {
    program = await getProgramAdmin(ctx, id);
  } catch (err) {
    if (err instanceof DalError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const [credentials, roles] = await Promise.all([listCredentialOptions(ctx), listProgramRoles(ctx, id)]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/programs" className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500 hover:text-charcoal">
          <ArrowLeft className="h-3.5 w-3.5" /> All programs
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{program.name}</h1>
      </div>

      <Card>
        <CardHeader title="Program details" description="Changes are audited" />
        {/* key resets uncontrolled fields after a successful save/revalidate */}
        <ProgramEditForm key={`${program.id}-${program.slug}-${program.isActive}`} program={program} credentials={credentials} />
      </Card>

      <Card>
        <CardHeader
          title="Program roles"
          description="Program admins manage shifts; head coaches and team managers can check volunteers in"
        />
        <ProgramRolesPanel programId={program.id} roles={roles} />
      </Card>
    </div>
  );
}
