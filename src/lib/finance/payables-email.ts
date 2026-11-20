import { escapeHtml } from "@/lib/email";
import { formatCents } from "@/lib/format";

/** Email templates for payables (Finance 2, PB). Every interpolated value is escaped. */

export interface BuiltEmail {
  subject: string;
  html: string;
}

export function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

function layout(body: string): string {
  return `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1c1917;">${body}</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin: 24px 0;"><a href="${escapeHtml(href)}" style="background: #0f172a; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">${escapeHtml(label)}</a></p>`;
}

function row(label: string, value: string): string {
  return `<tr><td style="padding: 4px 12px 4px 0; color: #78716c;">${escapeHtml(label)}</td><td style="padding: 4px 0; font-weight: 600;">${escapeHtml(value)}</td></tr>`;
}

export function approvalNeededEmail(a: {
  kind: "bill" | "reimbursement";
  payeeName: string;
  totalCents: number;
  memo: string;
  submittedBy: string;
  approvalsRequired: number;
  url: string;
}): BuiltEmail {
  const what = a.kind === "reimbursement" ? "reimbursement" : "bill";
  return {
    subject: `Approval needed: ${what} for ${a.payeeName} (${formatCents(a.totalCents)})`,
    html: layout(`
      <h2 style="margin: 0 0 8px;">A ${escapeHtml(what)} needs your approval</h2>
      <p style="color: #57534e;">${escapeHtml(a.submittedBy)} submitted it. ${a.approvalsRequired > 1 ? "Because of the amount, two different people need to approve it." : ""}</p>
      <table style="font-size: 14px; border-collapse: collapse;">
        ${row(a.kind === "reimbursement" ? "Pay back" : "Vendor", a.payeeName)}
        ${row("Amount", formatCents(a.totalCents))}
        ${row("For", a.memo)}
      </table>
      ${button(a.url, "Review and approve")}
      <p style="color: #78716c; font-size: 12px;">You can't approve something you created, submitted, or are being paid for.</p>
    `),
  };
}

export function billRejectedEmail(a: { name: string; payeeName: string; totalCents: number; reason: string; url: string }): BuiltEmail {
  return {
    subject: `A bill for ${a.payeeName} was sent back`,
    html: layout(`
      <h2 style="margin: 0 0 8px;">Your bill was sent back</h2>
      <p>The ${escapeHtml(formatCents(a.totalCents))} bill for ${escapeHtml(a.payeeName)} needs a change before it can be approved.</p>
      <p style="background: #f5f5f4; padding: 12px; border-radius: 8px;">${escapeHtml(a.reason)}</p>
      ${button(a.url, "Edit and resubmit")}
    `),
  };
}

export function reimbursementDecisionEmail(a: {
  name: string;
  approved: boolean;
  totalCents: number;
  memo: string;
  reason?: string | null;
  url: string;
}): BuiltEmail {
  if (a.approved) {
    return {
      subject: "Your reimbursement was approved",
      html: layout(`
        <h2 style="margin: 0 0 8px;">Your reimbursement was approved</h2>
        <p>Hi ${escapeHtml(a.name)}, your claim for ${escapeHtml(formatCents(a.totalCents))} (${escapeHtml(a.memo)}) was approved. We will email you again when it has been paid.</p>
        ${button(a.url, "View your claim")}
      `),
    };
  }
  return {
    subject: "Your reimbursement claim was not approved",
    html: layout(`
      <h2 style="margin: 0 0 8px;">Your claim was not approved</h2>
      <p>Hi ${escapeHtml(a.name)}, your claim for ${escapeHtml(formatCents(a.totalCents))} (${escapeHtml(a.memo)}) was not approved.</p>
      ${a.reason ? `<p style="background: #f5f5f4; padding: 12px; border-radius: 8px;">${escapeHtml(a.reason)}</p>` : ""}
      <p>If you have questions, reply to this email or contact the treasurer.</p>
      ${button(a.url, "View your claim")}
    `),
  };
}

export function reimbursementPaidEmail(a: {
  name: string;
  amountCents: number;
  methodLabel: string;
  dateText: string;
  reference: string | null;
  url: string;
}): BuiltEmail {
  return {
    subject: `Your reimbursement of ${formatCents(a.amountCents)} was paid`,
    html: layout(`
      <h2 style="margin: 0 0 8px;">Your reimbursement was paid</h2>
      <p>Hi ${escapeHtml(a.name)}, we paid you back.</p>
      <table style="font-size: 14px; border-collapse: collapse;">
        ${row("Amount", formatCents(a.amountCents))}
        ${row("Date", a.dateText)}
        ${row("How", a.methodLabel)}
        ${a.reference ? row("Reference", a.reference) : ""}
      </table>
      ${button(a.url, "View your claim")}
    `),
  };
}
