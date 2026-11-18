import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { NewProgramButton } from "@/components/programs/new-program-modal";
import { ProgramTable } from "@/components/programs/program-table";
import { isBoard, requireSession } from "@/lib/dal/context";
import { listCredentialOptions, listProgramsAdmin } from "@/lib/dal/programs";

export const metadata: Metadata = { title: "Programs" };

export default async function ProgramsPage() {
  const ctx = await requireSession("/admin/programs");
  if (!isBoard(ctx)) notFound();

  const [rows, credentials] = await Promise.all([listProgramsAdmin(ctx), listCredentialOptions(ctx)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Programs</h1>
        <p className="mt-1 text-sm text-stone-500">
          Manage GBYS programs and independent partner leagues, and who coaches or administers each one.
        </p>
      </div>
      <Card>
        <CardHeader
          title="All programs"
          description="Inactive programs are hidden from sign-up dropdowns but keep their history"
          action={<NewProgramButton credentials={credentials} />}
        />
        <ProgramTable rows={rows} />
      </Card>
    </div>
  );
}
