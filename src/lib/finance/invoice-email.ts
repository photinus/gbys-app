import { escapeHtml } from "@/lib/email";
import { formatCents, formatDob } from "@/lib/format";

/**
 * HTML invoice email (pure). Every interpolated value goes through escapeHtml; plain-text
 * fields keep their line breaks via <br>. The caller supplies an ABSOLUTE logo URL (or null).
 */

export interface InvoiceEmailInput {
  orgName: string;
  legalDesignation?: string | null;
  ein?: string | null;
  supportEmail?: string | null;
  /** Absolute https/http URL, or null for no logo. */
  logoUrl: string | null;
  number: number;
  customerName: string;
  issueDate: string;
  dueDate: string | null;
  memo: string | null;
  lines: { description: string; amountCents: number }[];
  totalCents: number;
  paidCents: number;
  paymentInstructions: string | null;
}

const multiline = (s: string) => escapeHtml(s).replace(/\r?\n/g, "<br>");

/** A header value must be one line. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export function invoiceEmailSubject(i: Pick<InvoiceEmailInput, "orgName" | "number">): string {
  return oneLine(`Invoice #${i.number} from ${i.orgName}`);
}

export function buildInvoiceEmail(i: InvoiceEmailInput): { subject: string; html: string } {
  const balance = i.totalCents - i.paidCents;
  const logo =
    i.logoUrl && /^https?:\/\//i.test(i.logoUrl)
      ? `<img src="${escapeHtml(i.logoUrl)}" alt="${escapeHtml(i.orgName)}" style="max-height: 56px; max-width: 200px; margin-bottom: 8px;">`
      : "";
  const legal = [i.legalDesignation, i.ein ? `EIN ${i.ein}` : null].filter((x): x is string => !!x).map(escapeHtml).join(" · ");
  const rows = i.lines
    .map(
      (l) =>
        `<tr><td style="padding: 8px 0; border-bottom: 1px solid #e7e5e4;">${multiline(l.description)}</td><td style="padding: 8px 0; border-bottom: 1px solid #e7e5e4; text-align: right; white-space: nowrap;">${escapeHtml(formatCents(l.amountCents))}</td></tr>`
    )
    .join("");
  const paidRow =
    i.paidCents > 0
      ? `<tr><td style="padding: 6px 0; color: #57534e;">Payments received</td><td style="padding: 6px 0; text-align: right; color: #57534e;">-${escapeHtml(formatCents(i.paidCents))}</td></tr>`
      : "";
  const html = `<div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1c1917;">
  ${logo}
  <h2 style="margin: 0 0 2px;">${escapeHtml(i.orgName)}</h2>
  ${legal ? `<p style="margin: 0 0 16px; color: #78716c; font-size: 12px;">${legal}</p>` : ""}
  <h3 style="margin: 16px 0 4px;">Invoice #${escapeHtml(String(i.number))}</h3>
  <p style="margin: 0 0 4px;">Billed to: <strong>${escapeHtml(i.customerName)}</strong></p>
  <p style="margin: 0 0 4px;">Issued: ${escapeHtml(formatDob(i.issueDate))}</p>
  <p style="margin: 0 0 16px;">Due: ${i.dueDate ? escapeHtml(formatDob(i.dueDate)) : "Upon receipt"}</p>
  ${i.memo ? `<p style="margin: 0 0 16px;">${multiline(i.memo)}</p>` : ""}
  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><td style="padding: 8px 0; font-weight: 600;">Total</td><td style="padding: 8px 0; text-align: right; font-weight: 600;">${escapeHtml(formatCents(i.totalCents))}</td></tr>
      ${paidRow}
      <tr><td style="padding: 8px 0; font-size: 16px; font-weight: 700;">Balance due</td><td style="padding: 8px 0; text-align: right; font-size: 16px; font-weight: 700;">${escapeHtml(formatCents(balance))}</td></tr>
    </tfoot>
  </table>
  ${
    i.paymentInstructions
      ? `<div style="margin-top: 20px; padding: 12px 14px; background: #f5f5f4; border-radius: 8px; font-size: 13px;"><strong>How to pay</strong><br>${multiline(i.paymentInstructions)}</div>`
      : ""
  }
  <p style="margin-top: 24px; color: #78716c; font-size: 12px;">Please include invoice #${escapeHtml(String(i.number))} with your payment.${
    i.supportEmail ? ` Questions? Contact ${escapeHtml(i.supportEmail)}.` : ""
  }</p>
</div>`;
  return { subject: invoiceEmailSubject(i), html };
}
