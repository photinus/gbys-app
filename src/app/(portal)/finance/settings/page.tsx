import type { Metadata } from "next";
import { guarded } from "@/components/finance/gl/guard";
import { AccessCard, PeriodCard, SettingsForm } from "@/components/finance/gl/settings-forms";
import { Card, CardHeader } from "@/components/ui";
import { requireSession } from "@/lib/dal/context";
import { getAccessOverview, getFinanceSettings } from "@/lib/dal/finance-settings";
import { laToday } from "@/lib/finance/dates";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Finance settings" };
export const dynamic = "force-dynamic";

export default async function FinanceSettingsPage() {
  const ctx = await requireSession("/finance/settings");
  const { settings, access } = await guarded(async () => ({
    settings: await getFinanceSettings(ctx),
    access: await getAccessOverview(ctx),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Finance settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          Fiscal year, automatic recording, closing the books and who can see or change the finances. Every change is audited.
          {settings.updatedByName ? ` Settings last saved ${formatDateTime(settings.updatedAt)} by ${settings.updatedByName}.` : ""}
        </p>
      </div>

      <Card>
        <CardHeader title="General" description="Fiscal year, Stripe payouts, approvals, donation receipts and invoice payment instructions" />
        <SettingsForm settings={settings} />
      </Card>

      <Card>
        <CardHeader title="Close the books" description="Lock past months so numbers that were reviewed can't change" />
        <PeriodCard settings={settings} today={laToday()} />
      </Card>

      <Card>
        <CardHeader title="Who has access" description="Finance access is separate from the rest of the app" />
        <AccessCard access={access} />
      </Card>
    </div>
  );
}
