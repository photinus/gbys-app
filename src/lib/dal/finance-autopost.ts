import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, type DbOrTx, type DbTx } from "@/db";
import {
  auditLogs,
  finAccounts,
  finJournalEntries,
  finSettings,
  finStripePayouts,
  paymentEvents,
  programs,
  registrations,
  seasons,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { addDays, laDateOf, type IsoDate } from "@/lib/finance/dates";
import { formatDate, laDateInputToUtc } from "@/lib/format";
import { getStripe, isStripeEnabled } from "@/lib/stripe";
import { DalError, type SessionContext } from "./context";
import { requireFinance } from "./finance-access";
import {
  getLockDate,
  postEntry,
  systemAccountId,
  voidEntry,
  type FinEntrySource,
  type PostLineInput,
} from "./finance-ledger";

/**
 * Auto-posting (workstream FC): GBYS-run registration money, partner application fees,
 * Stripe processing fees and payouts flow into the general ledger.
 *
 * Every journal write goes through postEntry / voidEntry. Posting is idempotent on
 * (source, sourceRef): registration / platform_fee entries use the payment_events id,
 * stripe_fee / stripe_payout entries use the Stripe po_ id.
 */

type EventKind = (typeof paymentEvents.$inferSelect)["kind"];

interface LoadedEvent {
  id: string;
  registrationId: string;
  programId: string | null;
  programName: string | null;
  isPartner: boolean | null;
  seasonName: string;
  kind: EventKind;
  amountCents: number;
  applicationFeeCents: number | null;
  stripeAccountId: string | null;
  method: "stripe" | "cash" | "check" | "scholarship" | null;
  note: string | null;
  occurredAt: Date;
  createdAt: Date;
}

type Plan =
  | { kind: "skip"; reason: string }
  | { kind: "post"; source: FinEntrySource; memo: string; lines: PostLineInput[] };

export type PostOneResult = { status: "posted" | "exists" | "skipped"; reason?: string };

async function loadEvent(tx: DbOrTx, id: string): Promise<LoadedEvent | null> {
  const [row] = await tx
    .select({
      id: paymentEvents.id,
      registrationId: paymentEvents.registrationId,
      programId: sql<string | null>`coalesce(${paymentEvents.programId}, ${seasons.programId})`,
      programName: programs.name,
      isPartner: programs.isIndependentPartner,
      seasonName: seasons.name,
      kind: paymentEvents.kind,
      amountCents: paymentEvents.amountCents,
      applicationFeeCents: paymentEvents.applicationFeeCents,
      stripeAccountId: paymentEvents.stripeAccountId,
      method: paymentEvents.method,
      note: paymentEvents.note,
      occurredAt: paymentEvents.occurredAt,
      createdAt: paymentEvents.createdAt,
    })
    .from(paymentEvents)
    .innerJoin(registrations, eq(registrations.id, paymentEvents.registrationId))
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .leftJoin(programs, eq(programs.id, sql`coalesce(${paymentEvents.programId}, ${seasons.programId})`))
    .where(eq(paymentEvents.id, id))
    .limit(1);
  return row ?? null;
}

async function getAutoPostStart(tx: DbOrTx): Promise<IsoDate | null> {
  const [row] = await tx
    .select({ d: finSettings.autoPostStartDate })
    .from(finSettings)
    .where(eq(finSettings.id, 1))
    .limit(1);
  return row?.d ?? null;
}

/** Any entry (live or voided) for this source object? A voided one means a person corrected it by hand. */
async function entryExists(
  tx: DbOrTx,
  source: FinEntrySource,
  ref: string,
  opts: { liveOnly?: boolean } = {}
): Promise<{ id: string; voided: boolean } | null> {
  const rows = await tx
    .select({ id: finJournalEntries.id, voidedAt: finJournalEntries.voidedAt })
    .from(finJournalEntries)
    .where(
      and(
        eq(finJournalEntries.source, source),
        eq(finJournalEntries.sourceRef, ref),
        opts.liveOnly ? isNull(finJournalEntries.voidedAt) : undefined
      )
    )
    .orderBy(sql`${finJournalEntries.voidedAt} is not null`, desc(finJournalEntries.createdAt))
    .limit(1);
  return rows[0] ? { id: rows[0].id, voided: !!rows[0].voidedAt } : null;
}

function describe(ev: LoadedEvent): string {
  return `${ev.programName ?? "Program"} - ${ev.seasonName}`;
}

/** Decide what (if anything) a payment event posts. Pure apart from the offline-void lookup. */
async function planEvent(
  tx: DbOrTx,
  ev: LoadedEvent,
  accts: { clearing: string; undeposited: string; revenue: string; platformFee: string },
  depth = 0
): Promise<Plan> {
  if (!ev.programId || ev.isPartner === null) return { kind: "skip", reason: "The payment has no program." };
  const lines = (debit: string, credit: string, amount: number, desc: string): PostLineInput[] => [
    { accountId: debit, programId: ev.programId, debitCents: amount, description: desc },
    { accountId: credit, programId: ev.programId, creditCents: amount, description: desc },
  ];
  const ref = `Registration ${ev.registrationId.slice(0, 8)}`;

  // Partner leagues charge on their own Stripe account: only GBYS's application fee is revenue.
  if (ev.isPartner) {
    if (ev.kind === "charge" && ev.stripeAccountId && (ev.applicationFeeCents ?? 0) > 0) {
      return {
        kind: "post",
        source: "platform_fee",
        memo: `Platform fee on partner registration: ${describe(ev)}`,
        lines: lines(accts.clearing, accts.platformFee, ev.applicationFeeCents!, ref),
      };
    }
    return { kind: "skip", reason: "Partner league money is not GBYS revenue." };
  }

  // GBYS-run program: stripe-kind events must be on the platform account.
  const stripeKind = ev.kind === "charge" || ev.kind === "refund" || ev.kind === "dispute_opened" || ev.kind === "dispute_closed";
  if (stripeKind && ev.stripeAccountId) return { kind: "skip", reason: "Charged on a connected account, not GBYS's." };
  if (ev.amountCents <= 0) return { kind: "skip", reason: "Zero amount." };
  const amt = ev.amountCents;

  switch (ev.kind) {
    case "charge":
      return { kind: "post", source: "registration", memo: `Card payment: ${describe(ev)}`, lines: lines(accts.clearing, accts.revenue, amt, ref) };
    case "refund":
      return { kind: "post", source: "registration", memo: `Card refund: ${describe(ev)}`, lines: lines(accts.revenue, accts.clearing, amt, ref) };
    case "dispute_opened":
      return { kind: "post", source: "registration", memo: `Dispute opened (funds withdrawn): ${describe(ev)}`, lines: lines(accts.revenue, accts.clearing, amt, ref) };
    case "dispute_closed": {
      // stripe-refunds records "Outcome: <status> (...)". won / warning_closed return the funds; anything else leaves them withdrawn.
      const outcome = /^Outcome: ([a-z_]+)/.exec(ev.note ?? "")?.[1] ?? "";
      if (outcome === "won" || outcome === "warning_closed") {
        return { kind: "post", source: "registration", memo: `Dispute ${outcome === "won" ? "won" : "closed"} (funds returned): ${describe(ev)}`, lines: lines(accts.clearing, accts.revenue, amt, ref) };
      }
      return { kind: "skip", reason: "Dispute lost: the withdrawal already posted when it opened." };
    }
    case "offline_payment":
      if (ev.method !== "cash" && ev.method !== "check") return { kind: "skip", reason: "Scholarships are not cash." };
      return {
        kind: "post",
        source: "registration",
        memo: `${ev.method === "cash" ? "Cash" : "Check"} payment: ${describe(ev)}${ev.note ? ` (${ev.note})` : ""}`,
        lines: lines(accts.undeposited, accts.revenue, amt, ref),
      };
    case "offline_void": {
      if (ev.method !== "cash" && ev.method !== "check") return { kind: "skip", reason: "Scholarship voids are not cash." };
      if (depth > 0) return { kind: "skip", reason: "Nested void." };
      // The void reverses the most recent offline payment of this registration. Only reverse it if that
      // payment actually reached the ledger (it may predate the start date, or have been fixed by hand).
      const [orig] = await tx
        .select({ id: paymentEvents.id })
        .from(paymentEvents)
        .where(
          and(
            eq(paymentEvents.registrationId, ev.registrationId),
            eq(paymentEvents.kind, "offline_payment"),
            eq(paymentEvents.method, ev.method),
            sql`${paymentEvents.occurredAt} <= ${ev.occurredAt}`
          )
        )
        .orderBy(desc(paymentEvents.occurredAt), desc(paymentEvents.createdAt))
        .limit(1);
      if (!orig) return { kind: "skip", reason: "No matching offline payment to reverse." };
      const hit = await entryExists(tx, "registration", orig.id);
      if (hit?.voided) return { kind: "skip", reason: "The original payment entry was already voided in the ledger." };
      if (!hit) {
        const origEv = await loadEvent(tx, orig.id);
        const start = await getAutoPostStart(tx);
        const origPlan = origEv ? await planEvent(tx, origEv, accts, depth + 1) : ({ kind: "skip", reason: "" } as Plan);
        const origDate = origEv ? laDateOf(origEv.occurredAt) : null;
        if (origPlan.kind === "post" && start && origDate && origDate >= start) {
          throw new Error("The payment this voids is not posted yet.");
        }
        return { kind: "skip", reason: "The voided payment was never posted to the ledger." };
      }
      return {
        kind: "post",
        source: "registration",
        memo: `Voided ${ev.method} payment: ${describe(ev)}${ev.note ? ` (${ev.note})` : ""}`,
        lines: lines(accts.revenue, accts.undeposited, amt, ref),
      };
    }
  }
}

async function accountSet(tx: DbOrTx) {
  return {
    clearing: await systemAccountId(tx, "stripe_clearing"),
    undeposited: await systemAccountId(tx, "undeposited_funds"),
    revenue: await systemAccountId(tx, "registration_revenue"),
    platformFee: await systemAccountId(tx, "platform_fee_revenue"),
  };
}

/** Entry date for something that happened on `date`: moves to lockDate + 1 when that period is closed. */
async function openEntryDate(tx: DbTx, date: IsoDate): Promise<{ date: IsoDate; note: string }> {
  const lock = await getLockDate(tx);
  if (lock && date <= lock) {
    return { date: addDays(lock, 1), note: ` (originally ${formatDate(`${date}T12:00:00`)})` };
  }
  return { date, note: "" };
}

/** Post one payment event inside the caller's transaction. Throws on ledger problems. */
async function postEventInTx(tx: DbTx, id: string): Promise<PostOneResult> {
  const start = await getAutoPostStart(tx);
  if (!start) return { status: "skipped", reason: "Auto-posting is off (no start date)." };
  const ev = await loadEvent(tx, id);
  if (!ev) return { status: "skipped", reason: "Payment event not found." };
  const eventDate = laDateOf(ev.occurredAt);
  if (eventDate < start) return { status: "skipped", reason: "Before the auto-post start date." };

  const accts = await accountSet(tx);
  const plan = await planEvent(tx, ev, accts);
  if (plan.kind === "skip") return { status: "skipped", reason: plan.reason };
  if (await entryExists(tx, plan.source, ev.id)) return { status: "exists" };

  const when = await openEntryDate(tx, eventDate);
  const res = await postEntry(tx, {
    entryDate: when.date,
    memo: plan.memo + when.note,
    source: plan.source,
    sourceRef: ev.id,
    createdByUserId: null,
    lines: plan.lines,
  });
  return { status: res.created ? "posted" : "exists" };
}

/** Post one payment_events row (idempotent). Never throws: failures leave it for the sweep. */
export async function postPaymentEventSafely(tx: DbTx, paymentEventId: string): Promise<void> {
  try {
    // A savepoint: a ledger error rolls back only this posting, never the webhook / payment transaction.
    await tx.transaction(async (sp) => {
      await postEventInTx(sp, paymentEventId);
    });
  } catch (err) {
    console.error("[finance-autopost] could not post payment event", { id: paymentEventId, message: (err as Error).message });
  }
}

const SWEEP_TARGET = "payment-sweep";

/** Events that belong in the ledger (GBYS money or partner fee), on/after the start date, with no entry yet. */
async function candidateIds(start: IsoDate, limit: number): Promise<string[]> {
  const startUtc = laDateInputToUtc(start, false);
  const res = await db.execute<{ id: string }>(sql`
    select pe.id
    from payment_events pe
    join registrations r on r.id = pe.registration_id
    join seasons s on s.id = r.season_id
    join programs p on p.id = coalesce(pe.program_id, s.program_id)
    where pe.occurred_at >= ${startUtc.toISOString()}::timestamptz
      and pe.amount_cents > 0
      and not exists (
        select 1 from fin_journal_entries e
        where e.source in ('registration', 'platform_fee') and e.source_ref = pe.id::text
      )
      and (
        (p.is_independent_partner and pe.kind = 'charge' and pe.stripe_account_id is not null
          and coalesce(pe.application_fee_cents, 0) > 0)
        or
        (not p.is_independent_partner and pe.stripe_account_id is null and pe.method is distinct from 'scholarship')
      )
    order by pe.occurred_at, pe.created_at, pe.id
    limit ${limit}
  `);
  return res.rows.map((r) => r.id);
}

export interface SweepResult {
  posted: number;
  skipped: number;
  failed: number;
}

/** System sweep (cron + manual button): post every unposted payment_event on/after the auto-post start date. */
export async function postPendingPayments(opts: { actorUserId?: string | null } = {}): Promise<SweepResult> {
  const out: SweepResult = { posted: 0, skipped: 0, failed: 0 };
  const [settings] = await db
    .select({ d: finSettings.autoPostStartDate })
    .from(finSettings)
    .where(eq(finSettings.id, 1))
    .limit(1);
  if (!settings?.d) return out; // auto-posting is off
  const ids = await candidateIds(settings.d, 5000);
  const failures: { id: string; message: string }[] = [];
  for (const id of ids) {
    try {
      const r = await db.transaction((tx) => postEventInTx(tx, id));
      if (r.status === "posted") out.posted++;
      else out.skipped++;
    } catch (err) {
      out.failed++;
      if (failures.length < 20) failures.push({ id, message: (err as Error).message.slice(0, 300) });
      console.error("[finance-autopost] sweep failed for event", { id, message: (err as Error).message });
    }
  }
  try {
    await writeAudit({
      actorUserId: opts.actorUserId ?? null,
      action: "finance.auto_posted",
      targetType: "fin_entry",
      targetId: SWEEP_TARGET,
      metadata: { ...out, considered: ids.length, trigger: opts.actorUserId ? "manual" : "system", failures },
    });
  } catch (err) {
    console.error("[finance-autopost] could not write sweep audit", (err as Error).message);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

/** Status text stored in fin_stripe_payouts.status. "paid_fees_unknown" = paid and posted, fee listing failed (retry from the page). */
export const PAYOUT_FEES_UNKNOWN = "paid_fees_unknown";

function payoutArrivalDate(payout: Stripe.Payout): IsoDate {
  const ts = payout.arrival_date ?? payout.created;
  // Stripe encodes the arrival *day* as midnight UTC; that calendar day is what the bank shows.
  if (ts % 86400 === 0) return new Date(ts * 1000).toISOString().slice(0, 10);
  return laDateOf(ts * 1000);
}

async function sumPayoutFees(payoutId: string): Promise<number> {
  let fees = 0;
  // Runs while the webhook transaction is open: fail fast (no retries) and fall back to "fees unknown".
  const list = getStripe().balanceTransactions.list({ payout: payoutId, limit: 100 }, { timeout: 10_000, maxNetworkRetries: 0 });
  for await (const bt of list) {
    if (bt.type === "payout") continue;
    fees += bt.fee ?? 0;
  }
  return fees;
}

async function payoutBankAccountId(tx: DbTx): Promise<string> {
  const [s] = await tx
    .select({ id: finSettings.stripePayoutAccountId })
    .from(finSettings)
    .where(eq(finSettings.id, 1))
    .limit(1);
  if (s?.id) {
    const [a] = await tx.select({ id: finAccounts.id, isActive: finAccounts.isActive }).from(finAccounts).where(eq(finAccounts.id, s.id)).limit(1);
    if (a?.isActive) return a.id;
  }
  return systemAccountId(tx, "checking");
}

async function postPaidPayout(
  tx: DbTx,
  payout: Stripe.Payout,
  prevStatus: string | null
): Promise<{ status: string; feesCents: number; entryId: string | null }> {
  const recovering = prevStatus === "failed" || prevStatus === "canceled";
  // prevStatus here is the status BEFORE this event (paid_pending is treated as "not completed").
  const payoutEntry = await entryExists(tx, "stripe_payout", payout.id);
  const feeEntry = await entryExists(tx, "stripe_fee", payout.id);

  // Fees: ask Stripe unless this payout was already completed (or a person fixed its entries by hand).
  let fees = 0;
  let feeStatus = "paid";
  const needFees = recovering || !feeEntry;
  if (needFees && (prevStatus !== "paid" || recovering)) {
    try {
      fees = await sumPayoutFees(payout.id);
    } catch (err) {
      feeStatus = PAYOUT_FEES_UNKNOWN;
      console.error("[finance-autopost] could not list balance transactions", { payout: payout.id, message: (err as Error).message });
    }
  }

  const arrival = payoutArrivalDate(payout);
  const when = await openEntryDate(tx, arrival);
  const clearing = await systemAccountId(tx, "stripe_clearing");

  let entryId: string | null = null;
  if (!payoutEntry || (payoutEntry.voided && recovering)) {
    if (payout.amount > 0) {
      const bank = await payoutBankAccountId(tx);
      const res = await postEntry(tx, {
        entryDate: when.date,
        memo: `Stripe payout ${payout.id}${when.note}`,
        source: "stripe_payout",
        sourceRef: payout.id,
        createdByUserId: null,
        lines: [
          { accountId: bank, debitCents: payout.amount, description: payout.id },
          { accountId: clearing, creditCents: payout.amount, description: payout.id },
        ],
      });
      entryId = res.entryId;
    }
  } else if (!payoutEntry.voided) {
    entryId = payoutEntry.id;
  }

  if (fees > 0 && (!feeEntry || (feeEntry.voided && recovering))) {
    const expense = await systemAccountId(tx, "payment_processing_fees");
    await postEntry(tx, {
      entryDate: when.date,
      memo: `Stripe processing fees for payout ${payout.id}${when.note}`,
      source: "stripe_fee",
      sourceRef: payout.id,
      createdByUserId: null,
      lines: [
        { accountId: expense, debitCents: fees, description: payout.id },
        { accountId: clearing, creditCents: fees, description: payout.id },
      ],
    });
  }
  return { status: feeStatus, feesCents: fees, entryId };
}

async function voidPayoutEntries(tx: DbTx, payoutId: string, reason: string): Promise<void> {
  for (const source of ["stripe_payout", "stripe_fee"] as const) {
    const live = await entryExists(tx, source, payoutId, { liveOnly: true });
    if (live) await voidEntry(tx, { entryId: live.id, userId: null, reason });
  }
}

/** "paid_pending" = Stripe says paid but posting hasn't succeeded yet (retry from the page). */
const PAYOUT_PAID_PENDING = "paid_pending";
/** Paid before the auto-post start date (or while auto-post is off): recorded, never posted. */
export const PAYOUT_BEFORE_START = "paid_not_tracked";
const FINAL_PAYOUT = new Set(["paid", PAYOUT_FEES_UNKNOWN, PAYOUT_PAID_PENDING, PAYOUT_BEFORE_START, "failed", "canceled"]);

/** Stripe webhook (platform account only): payout.paid / payout.failed / payout.canceled / payout.updated. */
export async function handlePayoutEvent(tx: DbTx, payout: Stripe.Payout, eventType: string): Promise<void> {
  if (!payout?.id || !payout.id.startsWith("po_")) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fin:payout:${payout.id}`}))`);
  const [prev] = await tx.select().from(finStripePayouts).where(eq(finStripePayouts.id, payout.id)).limit(1);
  const incoming = payout.status;
  // A late "in_transit" update must not undo "paid".
  if (prev && FINAL_PAYOUT.has(prev.status) && (incoming === "pending" || incoming === "in_transit")) return;

  const base = {
    amountCents: payout.amount,
    currency: payout.currency ?? "usd",
    arrivalDate: payoutArrivalDate(payout),
  };
  // "paid" is only recorded as completed once the entries are posted (see below).
  const holdStatus =
    incoming === "paid" ? (prev && (prev.status === "paid" || prev.status === PAYOUT_FEES_UNKNOWN) ? prev.status : PAYOUT_PAID_PENDING) : incoming;
  if (!prev) {
    await tx.insert(finStripePayouts).values({ id: payout.id, status: holdStatus, ...base });
  } else {
    await tx.update(finStripePayouts).set({ status: holdStatus, ...base }).where(eq(finStripePayouts.id, payout.id));
  }
  if ((payout.currency ?? "usd") !== "usd") {
    console.warn("[finance-autopost] non-USD payout not posted", payout.id);
    return;
  }

  try {
    await tx.transaction(async (sp) => {
      const start = incoming === "paid" ? await getAutoPostStart(sp) : null;
      if (incoming === "paid" && (!start || base.arrivalDate < start) && !(await entryExists(sp, "stripe_payout", payout.id))) {
        // Its charges were never auto-posted, so posting the payout would drive the Stripe balance negative.
        await sp.update(finStripePayouts).set({ status: PAYOUT_BEFORE_START, journalEntryId: null }).where(eq(finStripePayouts.id, payout.id));
        return;
      }
      if (incoming === "paid") {
        const r = await postPaidPayout(sp, payout, prev?.status ?? null);
        await sp
          .update(finStripePayouts)
          .set({ status: r.status, feesCents: r.feesCents || (prev?.status === "paid" ? prev.feesCents : 0), journalEntryId: r.entryId })
          .where(eq(finStripePayouts.id, payout.id));
      } else if (incoming === "failed" || incoming === "canceled") {
        await voidPayoutEntries(sp, payout.id, incoming === "failed" ? "Payout failed" : "Payout canceled");
        await sp.update(finStripePayouts).set({ feesCents: 0, journalEntryId: null }).where(eq(finStripePayouts.id, payout.id));
      }
      if (eventType !== "retry" && (incoming === "paid" || incoming === "failed" || incoming === "canceled")) {
        await writeAudit(
          {
            actorUserId: null,
            action: "finance.auto_posted",
            targetType: "fin_entry",
            targetId: payout.id,
            metadata: { payout: payout.id, event: eventType, status: incoming, amountCents: payout.amount },
          },
          sp
        );
      }
    });
  } catch (err) {
    console.error("[finance-autopost] payout handling failed", { payout: payout.id, eventType, message: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// /finance/stripe page: status + actions
// ---------------------------------------------------------------------------

export interface PendingEventRow {
  id: string;
  kind: EventKind;
  amountCents: number;
  occurredAt: Date;
  programName: string | null;
  reason: string;
}

export interface PayoutRow {
  id: string;
  amountCents: number;
  feesCents: number;
  status: string;
  arrivalDate: string;
  entryId: string | null;
  entryNumber: number | null;
  feeEntryId: string | null;
  feeEntryNumber: number | null;
  bankMatched: boolean;
  needsAttention: string | null;
}

export interface AutoPostStatus {
  stripeEnabled: boolean;
  autoPostStartDate: string | null;
  lockDate: string | null;
  payoutAccountName: string | null;
  lastSweep: { at: Date; posted: number; skipped: number; failed: number } | null;
  pendingCount: number;
  pending: PendingEventRow[];
  payouts: PayoutRow[];
  canEdit: boolean;
}

export async function getAutoPostStatus(ctx: SessionContext): Promise<AutoPostStatus> {
  const access = await requireFinance(ctx, "view_all");
  const [settings] = await db.select().from(finSettings).where(eq(finSettings.id, 1)).limit(1);
  const start = settings?.autoPostStartDate ?? null;

  let payoutAccountName: string | null = null;
  const acctId = settings?.stripePayoutAccountId ?? null;
  const [acct] = acctId
    ? await db.select({ name: finAccounts.name, code: finAccounts.code }).from(finAccounts).where(eq(finAccounts.id, acctId)).limit(1)
    : await db.select({ name: finAccounts.name, code: finAccounts.code }).from(finAccounts).where(eq(finAccounts.systemKey, "checking")).limit(1);
  if (acct) payoutAccountName = `${acct.code} ${acct.name}`;

  const [sweep] = await db
    .select({ at: auditLogs.createdAt, metadata: auditLogs.metadata })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "finance.auto_posted"), eq(auditLogs.targetId, SWEEP_TARGET)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  const meta = (sweep?.metadata ?? {}) as { posted?: number; skipped?: number; failed?: number; failures?: { id: string; message: string }[] };
  const failureById = new Map((meta.failures ?? []).map((f) => [f.id, f.message]));

  let pendingCount = 0;
  const pending: PendingEventRow[] = [];
  if (start) {
    // Candidates the planner would skip anyway (a lost dispute, a void of a never-posted payment) are not "waiting".
    const accts = await accountSet(db);
    const ids: string[] = [];
    const planReason = new Map<string, string>();
    for (const id of await candidateIds(start, 500)) {
      try {
        const ev = await loadEvent(db, id);
        if (!ev || laDateOf(ev.occurredAt) < start) continue;
        const plan = await planEvent(db, ev, accts);
        if (plan.kind === "post") ids.push(id);
      } catch (err) {
        ids.push(id);
        planReason.set(id, (err as Error).message);
      }
    }
    pendingCount = ids.length;
    if (ids.length) {
      const rows = await db
        .select({
          id: paymentEvents.id,
          kind: paymentEvents.kind,
          amountCents: paymentEvents.amountCents,
          occurredAt: paymentEvents.occurredAt,
          programName: programs.name,
        })
        .from(paymentEvents)
        .innerJoin(registrations, eq(registrations.id, paymentEvents.registrationId))
        .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
        .leftJoin(programs, eq(programs.id, sql`coalesce(${paymentEvents.programId}, ${seasons.programId})`))
        .where(inArray(paymentEvents.id, ids.slice(0, 25)))
        .orderBy(desc(paymentEvents.occurredAt));
      for (const r of rows) {
        const failed = failureById.get(r.id) ?? planReason.get(r.id);
        pending.push({
          ...r,
          reason: failed
            ? `Last attempt failed: ${failed}`
            : "Not posted yet. It will post on the next sweep, or use Post pending payments now.",
        });
      }
    }
  }

  const payoutRes = await db.execute<{
    id: string;
    amount_cents: number;
    fees_cents: number;
    status: string;
    arrival_date: string;
    entry_id: string | null;
    entry_number: string | null;
    fee_entry_id: string | null;
    fee_entry_number: string | null;
    bank_matched: boolean;
  }>(sql`
    select p.id, p.amount_cents, p.fees_cents, p.status, p.arrival_date::text as arrival_date,
           e.id as entry_id, e.entry_number::text as entry_number,
           fe.id as fee_entry_id, fe.entry_number::text as fee_entry_number,
           (e.id is not null and exists (select 1 from fin_bank_transactions bt where bt.journal_entry_id = e.id)) as bank_matched
    from fin_stripe_payouts p
    left join fin_journal_entries e on e.id = p.journal_entry_id and e.voided_at is null
    left join fin_journal_entries fe on fe.source = 'stripe_fee' and fe.source_ref = p.id and fe.voided_at is null
    order by p.arrival_date desc, p.created_at desc
    limit 25
  `);
  const payouts: PayoutRow[] = payoutRes.rows.map((r) => {
    let needsAttention: string | null = null;
    if (r.status === PAYOUT_FEES_UNKNOWN) needsAttention = "Fees could not be loaded from Stripe. Retry.";
    else if ((r.status === "failed" || r.status === "canceled") && (r.entry_id || r.fee_entry_id)) needsAttention = "Payout failed but its entries could not be voided (closed period or reconciled). Fix in the journal.";
    else if ((r.status === "paid" || r.status === PAYOUT_PAID_PENDING) && !r.entry_id && r.amount_cents > 0) needsAttention = "Paid but not posted. Retry.";
    return {
      id: r.id,
      amountCents: r.amount_cents,
      feesCents: r.fees_cents,
      status: r.status,
      arrivalDate: r.arrival_date,
      entryId: r.entry_id,
      entryNumber: r.entry_number ? Number(r.entry_number) : null,
      feeEntryId: r.fee_entry_id,
      feeEntryNumber: r.fee_entry_number ? Number(r.fee_entry_number) : null,
      bankMatched: r.bank_matched,
      needsAttention,
    };
  });

  return {
    stripeEnabled: isStripeEnabled(),
    autoPostStartDate: start,
    lockDate: settings?.lockDate ?? null,
    payoutAccountName,
    lastSweep: sweep ? { at: sweep.at, posted: meta.posted ?? 0, skipped: meta.skipped ?? 0, failed: meta.failed ?? 0 } : null,
    pendingCount,
    pending,
    payouts,
    canEdit: access.level === "admin" || access.level === "editor",
  };
}

/** "Post pending payments now" (edit). */
export async function runPostPendingNow(ctx: SessionContext): Promise<SweepResult> {
  await requireFinance(ctx, "edit");
  const [s] = await db.select({ d: finSettings.autoPostStartDate }).from(finSettings).where(eq(finSettings.id, 1)).limit(1);
  if (!s?.d) throw new DalError("INVALID", "Auto-posting is off. Set an auto-post start date in Finance settings first.");
  return postPendingPayments({ actorUserId: ctx.userId });
}

/** "Import recent payouts" (edit): list the last 30 days of payouts on the platform account and run the webhook handler. */
export async function importRecentPayouts(ctx: SessionContext): Promise<{ imported: number; failed: number }> {
  await requireFinance(ctx, "edit");
  if (!isStripeEnabled()) throw new DalError("INVALID", "Stripe is not configured.");
  const since = Math.floor(Date.now() / 1000) - 30 * 86400;
  const payouts: Stripe.Payout[] = [];
  try {
    for await (const p of getStripe().payouts.list({ created: { gte: since }, limit: 100 })) payouts.push(p);
  } catch (err) {
    console.error("[finance-autopost] payout import failed", (err as Error).message);
    throw new DalError("INVALID", "Stripe could not be reached. Nothing was imported; please try again.");
  }
  let imported = 0;
  let failed = 0;
  for (const p of payouts.reverse()) {
    try {
      await db.transaction((tx) => handlePayoutEvent(tx, p, "import"));
      imported++;
    } catch (err) {
      failed++;
      console.error("[finance-autopost] payout import row failed", { id: p.id, message: (err as Error).message });
    }
  }
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.auto_posted",
    targetType: "fin_entry",
    targetId: "payout-import",
    metadata: { payoutsFound: payouts.length, imported, failed },
  });
  return { imported, failed };
}

/** Re-fetch one payout from Stripe and re-run the handler (retry fees / posting). */
export async function retryPayout(ctx: SessionContext, payoutId: string): Promise<void> {
  await requireFinance(ctx, "edit");
  if (!/^po_[A-Za-z0-9_]+$/.test(payoutId)) throw new DalError("NOT_FOUND", "Payout not found.");
  if (!isStripeEnabled()) throw new DalError("INVALID", "Stripe is not configured.");
  let payout: Stripe.Payout;
  try {
    payout = await getStripe().payouts.retrieve(payoutId);
  } catch (err) {
    console.error("[finance-autopost] payout retrieve failed", (err as Error).message);
    throw new DalError("INVALID", "Stripe could not be reached. Please try again.");
  }
  await db.transaction((tx) => handlePayoutEvent(tx, payout, "retry"));
  await writeAudit({
    actorUserId: ctx.userId,
    action: "finance.auto_posted",
    targetType: "fin_entry",
    targetId: payoutId,
    metadata: { retry: true },
  });
}
