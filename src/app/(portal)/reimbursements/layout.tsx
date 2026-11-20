import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/features";

/** Member reimbursement claims are hidden until FEATURE_MEMBER_REIMBURSEMENTS=true. */
export default function ReimbursementsLayout({ children }: { children: ReactNode }) {
  if (!isFeatureEnabled("memberReimbursements")) notFound();
  return <>{children}</>;
}
