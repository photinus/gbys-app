import { escapeHtml } from "@/lib/email";
import { fmtLongDate, fmtMoney, type ReceiptDoc, type ReceiptGiftLine } from "./receipt-content";

/**
 * HTML email for a donation receipt / yearly statement. The wording comes from receipt-content.ts;
 * this module only lays it out. EVERY interpolated value goes through escapeHtml (donor names,
 * addresses, descriptions, signer, message...). Inline styles only (email clients).
 */

const e = escapeHtml;

export function receiptSubject(doc: ReceiptDoc): string {
  return doc.kind === "annual" ? `Your ${doc.taxYear} giving statement from ${doc.org.name}` : `Thank you for your gift to ${doc.org.name}`;
}

function giftRow(g: ReceiptGiftLine): string {
  const amount = g.isInKind ? "Non-cash gift" : fmtMoney(g.amountCents ?? 0);
  const goods = g.goodsServicesCents > 0 ? fmtMoney(g.goodsServicesCents) : "None";
  const deductible = g.isInKind ? "See below" : fmtMoney(g.deductibleCents ?? 0);
  const td = 'style="padding:8px 6px;border-bottom:1px solid #e7e5e4;font-size:14px;vertical-align:top;"';
  const tdr = 'style="padding:8px 6px;border-bottom:1px solid #e7e5e4;font-size:14px;text-align:right;vertical-align:top;white-space:nowrap;"';
  return `<tr><td ${td}>${e(fmtLongDate(g.date))}</td><td ${td}>${e(g.description)}</td><td ${tdr}>${e(amount)}</td><td ${tdr}>${e(goods)}</td><td ${tdr}>${e(deductible)}</td></tr>`;
}

function singleGift(g: ReceiptGiftLine): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#57534e;font-size:14px;width:45%;">${e(label)}</td><td style="padding:6px 0;font-size:14px;font-weight:600;">${e(value)}</td></tr>`;
  const rows = [row("Date of gift", fmtLongDate(g.date))];
  if (g.isInKind) {
    rows.push(row("Donated goods or services", g.description));
  } else {
    rows.push(row("Amount of contribution", fmtMoney(g.amountCents ?? 0)));
    rows.push(row("Type of gift", g.description));
    if (g.goodsServicesCents > 0) {
      rows.push(row("Value of goods or services provided", fmtMoney(g.goodsServicesCents)));
      rows.push(row("Tax-deductible amount", fmtMoney(g.deductibleCents ?? 0)));
    }
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid #e7e5e4;border-bottom:1px solid #e7e5e4;">${rows.join("")}</table>`;
}

function annualTable(doc: ReceiptDoc): string {
  const th = 'style="padding:8px 6px;border-bottom:2px solid #d6d3d1;font-size:12px;text-align:left;color:#57534e;"';
  const thr = 'style="padding:8px 6px;border-bottom:2px solid #d6d3d1;font-size:12px;text-align:right;color:#57534e;"';
  const t = doc.totals;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse;">
<tr><th ${th}>Date</th><th ${th}>Gift</th><th ${thr}>Amount</th><th ${thr}>Goods or services provided</th><th ${thr}>Deductible</th></tr>
${doc.gifts.map(giftRow).join("")}
<tr><td colspan="2" style="padding:10px 6px;font-size:14px;font-weight:700;">Total (cash gifts)</td><td style="padding:10px 6px;font-size:14px;font-weight:700;text-align:right;">${e(fmtMoney(t.amountCents))}</td><td style="padding:10px 6px;font-size:14px;text-align:right;">${e(fmtMoney(t.goodsServicesCents))}</td><td style="padding:10px 6px;font-size:14px;font-weight:700;text-align:right;">${e(fmtMoney(t.deductibleCents))}</td></tr>
</table>`;
}

/** Subject + HTML body for the email. */
export function renderReceiptEmail(doc: ReceiptDoc): { subject: string; html: string } {
  const logo = doc.org.logoUrl
    ? `<p style="margin:0 0 12px;"><img src="${e(doc.org.logoUrl)}" alt="${e(doc.org.name)}" height="56" style="height:56px;max-width:220px;"></p>`
    : "";
  const address = doc.addressLines.length
    ? `<p style="margin:0 0 16px;font-size:14px;color:#44403c;">${doc.addressLines.map(e).join("<br>")}</p>`
    : "";
  const signer = doc.signerName
    ? `<p style="margin:24px 0 0;font-size:14px;"><strong>${e(doc.signerName)}</strong>${doc.signerTitle ? `<br>${e(doc.signerTitle)}` : ""}<br>${e(doc.org.name)}</p>`
    : `<p style="margin:24px 0 0;font-size:14px;"><strong>${e(doc.org.name)}</strong></p>`;
  const body = doc.kind === "annual" ? annualTable(doc) : singleGift(doc.gifts[0]);
  const statements = doc.statements.map((s) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.5;">${e(s)}</p>`).join("");
  const heading =
    doc.kind === "annual"
      ? `<h1 style="margin:0 0 4px;font-size:20px;">${e(String(doc.taxYear))} giving statement</h1><p style="margin:0 0 16px;font-size:13px;color:#57534e;">Gifts received January 1 to December 31, ${e(String(doc.taxYear))}</p>`
      : `<h1 style="margin:0 0 16px;font-size:20px;">Thank you for your gift</h1>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#1c1917;">
${logo}<p style="margin:0 0 4px;font-size:16px;font-weight:700;">${e(doc.org.name)}</p>
<p style="margin:0 0 20px;font-size:12px;color:#57534e;">${e(fmtLongDate(doc.issuedOn))}</p>
<p style="margin:0 0 2px;font-size:14px;font-weight:600;">${e(doc.donor.name)}</p>
${address}${heading}
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;">Dear ${e(doc.donor.name)},</p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5;white-space:pre-line;">${e(doc.message)}</p>
${body}${statements}${signer}
</div>`;
  return { subject: receiptSubject(doc), html };
}
