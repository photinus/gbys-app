/**
 * Donation receipts — pure content builder (no DB, no server-only imports; safe anywhere).
 *
 * Follows IRS Publication 1771 (written acknowledgments of charitable gifts):
 *  - the organization's name (and, as a courtesy, its EIN and tax-exempt status);
 *  - the amount of CASH contributed, or — for non-cash gifts — a DESCRIPTION of the property,
 *    never a value (the donor decides the value);
 *  - a statement of whether any goods or services were provided in exchange. When they were:
 *    a description and good-faith estimate of their value, and the deductible amount. A payment
 *    of MORE than $75 that is partly a gift ("quid pro quo") also needs the disclosure sentence
 *    telling the donor the deduction is limited to the excess over the value received.
 *
 * `buildGiftReceipt` / `buildAnnualStatement` return a structured `ReceiptDoc` that both the email
 * template (receipt-email.ts) and the print pages render, so the wording lives in one place.
 * `warnings` are for the person sending the receipt and are never shown to donors.
 */
import type { IsoDate } from "./dates";

/** Gifts of at least this amount must be acknowledged in writing (IRS $250 rule). */
export const RECEIPT_REQUIRED_CENTS = 25_000;
/** A quid-pro-quo payment over this amount needs the written disclosure statement. */
export const QPQ_DISCLOSURE_OVER_CENTS = 7_500;

export type GiftKindValue = "cash" | "check" | "card" | "ach" | "stripe" | "in_kind" | "other";

export const GIFT_KIND_LABELS: Record<GiftKindValue, string> = {
  cash: "Cash",
  check: "Check",
  card: "Credit/debit card",
  ach: "Bank transfer (ACH)",
  stripe: "Online (Stripe)",
  in_kind: "In-kind (goods or services)",
  other: "Other",
};

export function isReceiptRequired(amountCents: number): boolean {
  return amountCents >= RECEIPT_REQUIRED_CENTS;
}

/** Deductible amount a receipt states: amount less goods/services. In-kind gifts state no value (0). */
export function deductibleCentsOf(g: { kind: GiftKindValue; amountCents: number; goodsServicesCents: number }): number {
  if (g.kind === "in_kind") return 0;
  return Math.max(0, g.amountCents - g.goodsServicesCents);
}

/** Amount a receipt states for a gift: in-kind gifts state no value (0). */
export function receiptAmountCentsOf(g: { kind: GiftKindValue; amountCents: number }): number {
  return g.kind === "in_kind" ? 0 : g.amountCents;
}

// ---------------------------------------------------------------------------
// Formatting (self-contained so the module stays dependency-free)
// ---------------------------------------------------------------------------

export function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-01" -> "November 1, 2026". */
export function fmtLongDate(iso: IsoDate): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReceiptOrg {
  /** Legal name. */
  name: string;
  /** e.g. "501(c)(3) nonprofit". */
  designation: string;
  ein: string | null;
  /** Absolute URL for emails, or a site-relative path for print pages. */
  logoUrl: string | null;
}

export interface ReceiptSettings {
  signerName: string | null;
  signerTitle: string | null;
  message: string | null;
}

export interface ReceiptDonor {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  email: string | null;
}

export interface ReceiptGiftInput {
  id: string;
  giftDate: IsoDate;
  amountCents: number;
  kind: GiftKindValue;
  inKindDescription: string | null;
  goodsServicesCents: number;
  goodsServicesDescription: string | null;
  reference: string | null;
}

export interface ReceiptGiftLine {
  giftId: string;
  date: IsoDate;
  kindLabel: string;
  isInKind: boolean;
  /** Cash amount; null for in-kind gifts (no value is stated). */
  amountCents: number | null;
  /** What was given: "Check #1042", "Online gift", or the in-kind description. */
  description: string;
  goodsServicesCents: number;
  goodsServicesDescription: string | null;
  /** Deductible amount for cash gifts; null for in-kind. */
  deductibleCents: number | null;
}

export interface ReceiptDoc {
  kind: "gift" | "annual";
  title: string;
  /** Calendar year for annual statements. */
  taxYear: number | null;
  org: ReceiptOrg;
  donor: ReceiptDonor;
  addressLines: string[];
  /** Date the receipt is issued. */
  issuedOn: IsoDate;
  gifts: ReceiptGiftLine[];
  totals: {
    giftCount: number;
    /** Sum of cash amounts. */
    amountCents: number;
    goodsServicesCents: number;
    /** Sum of cash deductible amounts. */
    deductibleCents: number;
    inKindCount: number;
  };
  /** Required statements, in order (org status, goods/services, disclosures, in-kind note). */
  statements: string[];
  /** Thank-you paragraph. */
  message: string;
  signerName: string | null;
  signerTitle: string | null;
  /** For the sender only (missing EIN, signer or donor address...). Never shown to donors. */
  warnings: string[];
  /** What a fin_receipts row should snapshot. */
  snapshot: { amountCents: number; deductibleCents: number };
}

export function donorAddressLines(d: ReceiptDonor): string[] {
  const lines: string[] = [];
  if (d.addressLine1) lines.push(d.addressLine1);
  if (d.addressLine2) lines.push(d.addressLine2);
  const cityLine = [d.city, [d.state, d.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  return lines;
}

function giftDescription(g: ReceiptGiftInput): string {
  if (g.kind === "in_kind") return g.inKindDescription?.trim() || "Donated goods or services";
  if (g.kind === "check") return g.reference ? `Check #${g.reference}` : "Check";
  if (g.kind === "cash") return "Cash";
  if (g.kind === "stripe" || g.kind === "card") return "Online or card gift";
  if (g.kind === "ach") return "Bank transfer";
  return g.reference ? `Gift (ref. ${g.reference})` : "Gift";
}

function toLine(g: ReceiptGiftInput): ReceiptGiftLine {
  const inKind = g.kind === "in_kind";
  return {
    giftId: g.id,
    date: g.giftDate,
    kindLabel: GIFT_KIND_LABELS[g.kind],
    isInKind: inKind,
    amountCents: inKind ? null : g.amountCents,
    description: giftDescription(g),
    goodsServicesCents: g.goodsServicesCents,
    goodsServicesDescription: g.goodsServicesDescription?.trim() || null,
    deductibleCents: inKind ? null : deductibleCentsOf(g),
  };
}

export const DEFAULT_THANK_YOU = "Thank you for your generous support. Your gift helps local kids play.";
export const KEEP_RECORDS = "Please keep this letter for your tax records.";
export const IN_KIND_NOTE =
  "No value is stated for donated goods or services. You are responsible for determining the fair market value of non-cash gifts for your tax return.";

function orgStatus(org: ReceiptOrg): string {
  const status = org.designation.trim() ? `a ${org.designation.trim()}` : "a tax-exempt organization";
  return org.ein ? `${org.name} is ${status}. Our EIN (tax ID) is ${org.ein}.` : `${org.name} is ${status}.`;
}

function orgWarnings(org: ReceiptOrg, s: ReceiptSettings, donor: ReceiptDonor): string[] {
  const w: string[] = [];
  if (!org.ein) w.push("Your organization's EIN is not set (Admin settings), so receipts will not show a tax ID.");
  if (!s.signerName) w.push("No receipt signer is set in Finance settings.");
  if (donorAddressLines(donor).length === 0) w.push("This donor has no mailing address on file.");
  return w;
}

/** Statement(s) about goods or services for ONE gift (used for single receipts and annual lines). */
export function goodsServicesStatements(g: ReceiptGiftInput): string[] {
  const inKind = g.kind === "in_kind";
  if (g.goodsServicesCents <= 0) {
    return [
      inKind
        ? "No goods or services were provided in exchange for this donation."
        : "No goods or services were provided in exchange for this contribution.",
    ];
  }
  const what = g.goodsServicesDescription?.trim() || "goods or services";
  const value = fmtMoney(g.goodsServicesCents);
  if (inKind) {
    return [
      `In exchange for this donation, we provided ${what}. The good-faith estimate of its value is ${value}. Your deduction for the donated property is limited to its fair market value less ${value}.`,
    ];
  }
  const deductible = deductibleCentsOf(g);
  const out = [
    `In exchange for this contribution of ${fmtMoney(g.amountCents)}, we provided ${what}. The good-faith estimate of the value of those goods or services is ${value}. The amount of your contribution that is tax-deductible is ${fmtMoney(deductible)}.`,
  ];
  if (g.amountCents > QPQ_DISCLOSURE_OVER_CENTS) {
    out.push(
      `Because your payment of ${fmtMoney(g.amountCents)} is more than $75, federal law requires us to tell you that the deductible part of your payment is limited to the amount that is more than the value of the goods or services you received.`
    );
  }
  return out;
}

export interface BuildGiftReceiptInput {
  org: ReceiptOrg;
  settings: ReceiptSettings;
  donor: ReceiptDonor;
  gift: ReceiptGiftInput;
  issuedOn: IsoDate;
}

/** One receipt for one gift. */
export function buildGiftReceipt(i: BuildGiftReceiptInput): ReceiptDoc {
  const line = toLine(i.gift);
  const inKind = line.isInKind;
  const statements = [orgStatus(i.org), ...goodsServicesStatements(i.gift)];
  if (inKind) statements.push(IN_KIND_NOTE);
  statements.push(KEEP_RECORDS);
  const amount = line.amountCents ?? 0;
  return {
    kind: "gift",
    title: "Thank you for your gift",
    taxYear: null,
    org: i.org,
    donor: i.donor,
    addressLines: donorAddressLines(i.donor),
    issuedOn: i.issuedOn,
    gifts: [line],
    totals: {
      giftCount: 1,
      amountCents: amount,
      goodsServicesCents: i.gift.goodsServicesCents,
      deductibleCents: line.deductibleCents ?? 0,
      inKindCount: inKind ? 1 : 0,
    },
    statements,
    message: i.settings.message?.trim() || DEFAULT_THANK_YOU,
    signerName: i.settings.signerName?.trim() || null,
    signerTitle: i.settings.signerTitle?.trim() || null,
    warnings: orgWarnings(i.org, i.settings, i.donor),
    snapshot: { amountCents: receiptAmountCentsOf(i.gift), deductibleCents: deductibleCentsOf(i.gift) },
  };
}

export interface BuildAnnualInput {
  org: ReceiptOrg;
  settings: ReceiptSettings;
  donor: ReceiptDonor;
  taxYear: number;
  gifts: ReceiptGiftInput[];
  issuedOn: IsoDate;
}

/** One statement listing all of a donor's gifts for a calendar year. */
export function buildAnnualStatement(i: BuildAnnualInput): ReceiptDoc {
  const gifts = [...i.gifts].sort((a, b) => (a.giftDate < b.giftDate ? -1 : a.giftDate > b.giftDate ? 1 : a.id.localeCompare(b.id)));
  const lines = gifts.map(toLine);
  const money = gifts.filter((g) => g.kind !== "in_kind");
  const inKindCount = gifts.length - money.length;
  const amountCents = money.reduce((s, g) => s + g.amountCents, 0);
  const goodsServicesCents = gifts.reduce((s, g) => s + g.goodsServicesCents, 0);
  const deductibleCents = money.reduce((s, g) => s + deductibleCentsOf(g), 0);

  const statements: string[] = [orgStatus(i.org)];
  const withGoods = gifts.filter((g) => g.goodsServicesCents > 0);
  if (withGoods.length === 0) {
    statements.push(
      gifts.length === 1
        ? "No goods or services were provided in exchange for this contribution."
        : "No goods or services were provided in exchange for any of the contributions listed above."
    );
  } else {
    statements.push(
      withGoods.length === gifts.length
        ? "Goods or services were provided in exchange for the contributions listed above, as described here."
        : "Except as described here, no goods or services were provided in exchange for the contributions listed above."
    );
    for (const g of withGoods) {
      for (const s of goodsServicesStatements(g)) statements.push(`${fmtLongDate(g.giftDate)}: ${s}`);
    }
  }
  if (inKindCount > 0) statements.push(IN_KIND_NOTE);
  statements.push(KEEP_RECORDS);

  return {
    kind: "annual",
    title: `${i.taxYear} giving statement`,
    taxYear: i.taxYear,
    org: i.org,
    donor: i.donor,
    addressLines: donorAddressLines(i.donor),
    issuedOn: i.issuedOn,
    gifts: lines,
    totals: { giftCount: gifts.length, amountCents, goodsServicesCents, deductibleCents, inKindCount },
    statements,
    message: i.settings.message?.trim() || DEFAULT_THANK_YOU,
    signerName: i.settings.signerName?.trim() || null,
    signerTitle: i.settings.signerTitle?.trim() || null,
    warnings: orgWarnings(i.org, i.settings, i.donor),
    snapshot: { amountCents, deductibleCents },
  };
}

// ---------------------------------------------------------------------------
// Receipt status
// ---------------------------------------------------------------------------

export type ReceiptStatusKind = "not_sent" | "emailed" | "printed" | "annual" | "none";

export interface ReceiptStatus {
  kind: ReceiptStatusKind;
  /** ISO timestamp of the receipt that acknowledged the gift. */
  at: string | null;
  /** A receipt exists but the gift changed since (amount or donor). */
  outdated: boolean;
  /** Needs a receipt now: not acknowledged (or outdated) and receiptable. */
  needsReceipt: boolean;
  /** Gift is >= $250 so written acknowledgment is required. */
  required: boolean;
}

export interface ReceiptStatusInput {
  voided: boolean;
  hasDonor: boolean;
  kind: GiftKindValue;
  amountCents: number;
  goodsServicesCents: number;
  /** Latest gift receipt for the same donor. */
  giftReceipt: { method: string; at: string; amountCents: number; deductibleCents: number } | null;
  /** Annual statement for the donor + gift year sent after the gift was recorded. */
  annualReceipt: { method: string; at: string } | null;
}

export function receiptStatusOf(i: ReceiptStatusInput): ReceiptStatus {
  const required = isReceiptRequired(i.amountCents);
  if (i.voided || !i.hasDonor) {
    return { kind: "none", at: null, outdated: false, needsReceipt: false, required: false };
  }
  if (i.giftReceipt) {
    const outdated =
      i.giftReceipt.amountCents !== receiptAmountCentsOf(i) || i.giftReceipt.deductibleCents !== deductibleCentsOf(i);
    return {
      kind: i.giftReceipt.method === "email" ? "emailed" : "printed",
      at: i.giftReceipt.at,
      outdated,
      needsReceipt: outdated,
      required,
    };
  }
  if (i.annualReceipt) {
    return { kind: "annual", at: i.annualReceipt.at, outdated: false, needsReceipt: false, required };
  }
  return { kind: "not_sent", at: null, outdated: false, needsReceipt: true, required };
}

/** "Not sent", "Emailed Nov 3, 2026", "Printed Nov 3, 2026", ... `fmt` formats the ISO timestamp. */
export function receiptStatusLabel(s: ReceiptStatus, fmt: (iso: string) => string): string {
  switch (s.kind) {
    case "none":
      return "No receipt needed";
    case "not_sent":
      return "Not sent";
    case "emailed":
      return `Emailed ${fmt(s.at!)}${s.outdated ? " (gift changed since)" : ""}`;
    case "printed":
      return `Printed ${fmt(s.at!)}${s.outdated ? " (gift changed since)" : ""}`;
    case "annual":
      return `In yearly statement (${fmt(s.at!)})`;
  }
}
