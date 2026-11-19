import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  Building2,
  CalendarClock,
  Gift,
  Receipt,
  Target,
  FileText,
  ClipboardList,
  FileDown,
  HandCoins,
  Landmark,
  PieChart,
  Scale,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { guard } from "@/components/finance/reports/page-helpers";
import { fmtIso } from "@/components/finance/reports/report-ui";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/dal/context";
import { getReportMeta } from "@/lib/dal/finance-reports";

export const metadata: Metadata = { title: "Finance reports" };
export const dynamic = "force-dynamic";

interface ReportCard {
  href: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
  /** Needs org-wide access. */
  all?: boolean;
}

const REPORTS: ReportCard[] = [
  {
    href: "/finance/reports/activities",
    title: "Statement of activities",
    blurb: "Money in and money out for a period, split by donor restrictions, with the change in net assets.",
    icon: ClipboardList,
  },
  {
    href: "/finance/reports/position",
    title: "Statement of financial position",
    blurb: "What we own, what we owe and what is left (net assets) on any date. The balance sheet.",
    icon: Landmark,
    all: true,
  },
  {
    href: "/finance/reports/fund-balances",
    title: "Fund balances",
    blurb: "How much is in each fund, including donor-restricted money, and what was spent from it.",
    icon: Wallet,
  },
  {
    href: "/finance/reports/programs",
    title: "Program summary",
    blurb: "Revenue, expenses and surplus for each program.",
    icon: PieChart,
  },
  {
    href: "/finance/reports/functional-expenses",
    title: "Functional expenses",
    blurb: "Expenses by program services, management & general and fundraising (Form 990 style).",
    icon: Building2,
    all: true,
  },
  {
    href: "/finance/reports/register",
    title: "Account register",
    blurb: "Every line posted to one account, with a running balance. The general ledger for an account.",
    icon: BookOpen,
  },
  {
    href: "/finance/reports/trial-balance",
    title: "Trial balance",
    blurb: "Every account’s balance in debit and credit columns. Totals must match.",
    icon: Scale,
    all: true,
  },
  {
    href: "/finance/reports/budget",
    title: "Budget vs. actual",
    blurb: "How actual revenue and expenses compare with the adopted budget, by account and program.",
    icon: Target,
  },
  {
    href: "/finance/reports/ap-aging",
    title: "Bills aging (A/P)",
    blurb: "Unpaid bills and reimbursements by how overdue they are.",
    icon: CalendarClock,
    all: true,
  },
  {
    href: "/finance/reports/ar-aging",
    title: "Invoices aging (A/R)",
    blurb: "Unpaid invoices by how overdue they are.",
    icon: Receipt,
    all: true,
  },
  {
    href: "/finance/reports/donors",
    title: "Donor report",
    blurb: "Gifts by donor for a period, with acknowledgment (receipt) status.",
    icon: Gift,
    all: true,
  },
  {
    href: "/finance/reports/1099",
    title: "1099 vendors",
    blurb: "Payments to 1099 vendors for a calendar year, with W-9 status.",
    icon: FileText,
    all: true,
  },
  {
    href: "/finance/reports/cpa-export",
    title: "CPA export",
    blurb: "A spreadsheet of every journal line for your accountant or tax preparer.",
    icon: FileDown,
    all: true,
  },
];

export default async function ReportsIndexPage() {
  const ctx = await requireSession("/finance/reports");
  const meta = await guard(getReportMeta(ctx));
  const visible = REPORTS.filter((r) => !r.all || meta.canViewAll);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Reports</h1>
        <p className="mt-1 text-sm text-stone-500">
          Financial reports for the board. Fiscal year {meta.fy.label}: {fmtIso(meta.fy.from)} to {fmtIso(meta.fy.to)}.
          {!meta.canViewAll ? " You can see the lines for the programs you have been given access to." : ""}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => {
          const Icon = r.icon;
          return (
            <Link key={r.href} href={r.href} className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-periwinkle/60 rounded-[26px]">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-lavender-card text-indigo-900">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-charcoal">{r.title}</h2>
                    <p className="mt-1 text-sm text-stone-500">{r.blurb}</p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
      <p className="flex items-center gap-2 text-xs text-stone-500">
        <HandCoins className="h-4 w-4" aria-hidden />
        <span>
          Voided entries never appear in reports. Every report has a <Badge tone="neutral">Download CSV</Badge> button and prints cleanly.
        </span>
      </p>
    </div>
  );
}
