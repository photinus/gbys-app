import type { Metadata } from "next";
import { Card, CardHeader } from "@/components/ui/card";
import { guard } from "@/components/finance/banking/guard";
import { RulesList } from "@/components/finance/banking/rules-list";
import { requireSession } from "@/lib/dal/context";
import { getBankingOptions, getBankingOverview } from "@/lib/dal/finance-banking";
import { listRules } from "@/lib/dal/finance-rules";

export const metadata: Metadata = { title: "Bank rules" };
export const dynamic = "force-dynamic";

export default async function BankRulesPage() {
  const ctx = await requireSession("/finance/banking/rules");
  const [rules, options, overview] = await guard(() => Promise.all([listRules(ctx), getBankingOptions(ctx), getBankingOverview(ctx)]));
  return (
    <Card>
      <CardHeader
        title="Rules"
        description="Rules sort repeat transactions for you. Rules are checked from the top; the first match wins. Rules that only suggest never post anything without your OK."
      />
      <RulesList rules={rules} options={options} canEdit={overview.canEdit} />
    </Card>
  );
}
