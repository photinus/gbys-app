import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { MyCredentialsTable } from "@/components/compliance/my-credentials-table";
import { UploadCredentialModal } from "@/components/compliance/upload-credential-modal";
import { listCredentialDefinitions, listMyCredentials } from "@/lib/dal/compliance";
import { requireSession } from "@/lib/dal/context";
import { ALLOWED_PROOF_TYPES, MAX_PROOF_BYTES } from "@/lib/storage";

export const metadata: Metadata = { title: "My Credentials" };

export default async function CredentialsPage() {
  const ctx = await requireSession("/volunteer/credentials");
  const [definitions, credentials] = await Promise.all([
    listCredentialDefinitions(ctx),
    listMyCredentials(ctx),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">My credentials</h1>
        <p className="mt-1 text-sm text-stone-500">
          Background checks and trainings required to coach or volunteer. We only store your confirmation
          number and proof of completion, never your SSN or report details.
        </p>
      </div>
      <Card>
        <CardHeader
          title="Credential vault"
          description="Submissions are reviewed by a board member."
          action={
            <UploadCredentialModal
              definitions={definitions.map((d) => ({
                id: d.id,
                name: d.name,
                defaultValidityMonths: d.defaultValidityMonths,
              }))}
              allowedTypes={[...ALLOWED_PROOF_TYPES]}
              maxBytes={MAX_PROOF_BYTES}
            />
          }
        />
        <MyCredentialsTable rows={credentials} />
      </Card>
    </div>
  );
}
