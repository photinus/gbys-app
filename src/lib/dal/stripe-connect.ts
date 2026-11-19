import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { db, type DbOrTx, type DbTx } from "@/db";
import { programs, seasons } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { getStripe, isStripeEnabled, computePlatformFeeCents, paymentRouteFor, type PaymentRoute } from "@/lib/stripe";
import { platformFeeSchema, type PlatformFeeInput } from "@/lib/validation/payments-settings";
import { computeSeasonStatus } from "@/lib/validation/seasons";
import { DalError, isBoard, type SessionContext } from "./context";
import { assertProgramReachable, canManageProgram } from "./permissions";

/**
 * Stripe Connect onboarding + program payment settings (Sprint 3b, worker PA).
 * Partner programs are Standard connected accounts (direct charges); GBYS-run
 * programs charge on the platform account and never onboard.
 * CONTRACT used by the webhook (worker PB): handleAccountUpdated(account).
 */

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const forbidden = () => new DalError("FORBIDDEN", "You do not have permission to do that.");
const notFound = () => new DalError("NOT_FOUND", "Program not found.");
const stripeFailed = () => new DalError("INVALID", "Stripe could not complete that request. Please try again.");

export const EXAMPLE_REGISTRATION_FEE_CENTS = 6500;

export interface FeePreviewRow {
  label: string;
  feeCents: number;
  platformFeeCents: number;
  leagueReceivesCents: number;
}

export interface PaymentSetup {
  program: { id: string; slug: string; name: string; isActive: boolean; isIndependentPartner: boolean };
  stripeEnabled: boolean;
  route: PaymentRoute;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingComplete: boolean;
  syncedAt: Date | null;
  platformFeeCents: number;
  platformFeeBps: number;
  /** Worked examples: the open seasons' fees, or a $65 example when none are open. */
  feePreview: FeePreviewRow[];
  canSetFee: boolean;
}

type ProgramRow = typeof programs.$inferSelect;

function appBase(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function parseId(id: string): string {
  if (!uuidRe.test(id)) throw notFound();
  return id;
}

async function loadProgram(tx: DbOrTx, programId: string, lock = false): Promise<ProgramRow> {
  const q = tx
    .select()
    .from(programs)
    .where(and(eq(programs.id, programId), isNull(programs.deletedAt)))
    .limit(1);
  const [p] = await (lock ? q.for("update") : q);
  if (!p) throw notFound();
  return p;
}

/** Resolves a program for a manager: NOT_FOUND hides it from non-managers. */
async function loadManaged(ctx: SessionContext, programId: string, tx: DbOrTx = db, lock = false): Promise<ProgramRow> {
  parseId(programId);
  if (!canManageProgram(ctx, programId)) throw notFound();
  await assertProgramReachable(ctx, programId, tx);
  return loadProgram(tx, programId, lock);
}

/** Program id for a slug, only when ctx manages it (else NOT_FOUND). For pages/routes. */
export async function resolveManagedProgramId(ctx: SessionContext, slug: string): Promise<string> {
  const [p] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.slug, slug), isNull(programs.deletedAt)))
    .limit(1);
  if (!p || !canManageProgram(ctx, p.id)) throw notFound();
  await assertProgramReachable(ctx, p.id);
  return p.id;
}

function previewRow(label: string, feeCents: number, p: ProgramRow): FeePreviewRow {
  const platformFeeCents = computePlatformFeeCents(feeCents, p);
  return { label, feeCents, platformFeeCents, leagueReceivesCents: feeCents - platformFeeCents };
}

export async function getPaymentSetup(ctx: SessionContext, programId: string): Promise<PaymentSetup> {
  const p = await loadManaged(ctx, programId);
  const seasonRows = await db
    .select({
      name: seasons.name,
      baseFeeCents: seasons.baseFeeCents,
      isActive: seasons.isActive,
      waiverVersionId: seasons.waiverVersionId,
      registrationOpensAt: seasons.registrationOpensAt,
      registrationClosesAt: seasons.registrationClosesAt,
    })
    .from(seasons)
    .where(eq(seasons.programId, p.id));
  const now = new Date();
  const open = seasonRows.filter((s) => s.baseFeeCents > 0 && computeSeasonStatus(s, now) === "open");
  const feePreview = open.length
    ? open.map((s) => previewRow(s.name, s.baseFeeCents, p))
    : [previewRow("Example registration", EXAMPLE_REGISTRATION_FEE_CENTS, p)];

  return {
    program: { id: p.id, slug: p.slug, name: p.name, isActive: p.isActive, isIndependentPartner: p.isIndependentPartner },
    stripeEnabled: isStripeEnabled(),
    route: paymentRouteFor(p),
    stripeAccountId: p.stripeAccountId,
    chargesEnabled: p.stripeChargesEnabled,
    detailsSubmitted: p.stripeDetailsSubmitted,
    onboardingComplete: p.stripeOnboardingComplete,
    syncedAt: p.stripeAccountSyncedAt,
    platformFeeCents: p.platformFeeCents,
    platformFeeBps: p.platformFeeBps,
    feePreview,
    canSetFee: isBoard(ctx),
  };
}

/**
 * Creates (once) the program's Standard account and returns a fresh Account Link URL.
 * The program row is locked FOR UPDATE across the check-and-create, so concurrent
 * clicks produce exactly one connected account.
 */
export async function startOnboarding(ctx: SessionContext, programId: string): Promise<{ url: string; slug: string }> {
  parseId(programId);
  if (!canManageProgram(ctx, programId)) throw forbidden();
  if (!isStripeEnabled()) throw new DalError("INVALID", "Online card payments are not enabled yet.");

  const prepared = await db.transaction(async (tx) => {
    const p = await loadManaged(ctx, programId, tx, true);
    if (!p.isIndependentPartner) {
      throw new DalError("INVALID", "GBYS-run programs take card payments on the GBYS account; there is nothing to connect.");
    }
    let accountId = p.stripeAccountId;
    let created = false;
    if (!accountId) {
      try {
        const account = await getStripe().accounts.create(
          {
            type: "standard",
            email: ctx.email,
            business_profile: { name: p.name },
            metadata: { programId: p.id },
          },
          { idempotencyKey: `connect-account:${p.id}` }
        );
        accountId = account.id;
      } catch (err) {
        console.error("[stripe-connect] accounts.create failed", (err as Error).message);
        throw stripeFailed();
      }
      await tx.update(programs).set({ stripeAccountId: accountId }).where(eq(programs.id, p.id));
      created = true;
    }
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "stripe.onboarding_started",
        targetType: "program",
        targetId: p.id,
        metadata: { stripeAccountId: accountId, accountCreated: created },
      },
      tx
    );
    return { accountId, slug: p.slug };
  });

  try {
    const link = await getStripe().accountLinks.create({
      account: prepared.accountId,
      type: "account_onboarding",
      refresh_url: `${appBase()}/programs/${prepared.slug}/payments/refresh`,
      return_url: `${appBase()}/programs/${prepared.slug}/payments/return`,
    });
    return { url: link.url, slug: prepared.slug };
  } catch (err) {
    console.error("[stripe-connect] accountLinks.create failed", (err as Error).message);
    throw stripeFailed();
  }
}

interface AccountFlags {
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingComplete: boolean;
}

/** Applies Stripe's account state to the locked program row; audits when something changed. */
async function applyAccountState(
  tx: DbTx,
  p: ProgramRow,
  account: Pick<Stripe.Account, "charges_enabled" | "details_submitted">,
  actorUserId: string | null
): Promise<AccountFlags & { changed: boolean }> {
  const after: AccountFlags = {
    chargesEnabled: !!account.charges_enabled,
    detailsSubmitted: !!account.details_submitted,
    onboardingComplete: !!account.charges_enabled && !!account.details_submitted,
  };
  const before: AccountFlags = {
    chargesEnabled: p.stripeChargesEnabled,
    detailsSubmitted: p.stripeDetailsSubmitted,
    onboardingComplete: p.stripeOnboardingComplete,
  };
  const changed =
    before.chargesEnabled !== after.chargesEnabled ||
    before.detailsSubmitted !== after.detailsSubmitted ||
    before.onboardingComplete !== after.onboardingComplete;
  await tx
    .update(programs)
    .set({
      stripeChargesEnabled: after.chargesEnabled,
      stripeDetailsSubmitted: after.detailsSubmitted,
      stripeOnboardingComplete: after.onboardingComplete,
      stripeAccountSyncedAt: new Date(),
    })
    .where(eq(programs.id, p.id));
  if (changed) {
    await writeAudit(
      {
        actorUserId,
        action: "stripe.account_updated",
        targetType: "program",
        targetId: p.id,
        metadata: { stripeAccountId: p.stripeAccountId, before, after },
      },
      tx
    );
  }
  return { ...after, changed };
}

/** Pulls the account from Stripe and syncs the program (Account Link return route and "Check status"). */
export async function refreshAccountStatus(
  ctx: SessionContext,
  programId: string
): Promise<{ slug: string; onboardingComplete: boolean; chargesEnabled: boolean; detailsSubmitted: boolean }> {
  parseId(programId);
  if (!canManageProgram(ctx, programId)) throw forbidden();
  if (!isStripeEnabled()) throw new DalError("INVALID", "Online card payments are not enabled yet.");
  const p = await loadManaged(ctx, programId);
  if (!p.isIndependentPartner) throw new DalError("INVALID", "GBYS-run programs have no connected account.");
  if (!p.stripeAccountId) throw new DalError("INVALID", "Connect Stripe first.");

  let account: Stripe.Account;
  try {
    account = await getStripe().accounts.retrieve(p.stripeAccountId);
  } catch (err) {
    console.error("[stripe-connect] accounts.retrieve failed", (err as Error).message);
    throw stripeFailed();
  }
  const accountId = p.stripeAccountId;
  return db.transaction(async (tx) => {
    const locked = await loadProgram(tx, programId, true);
    if (locked.stripeAccountId !== accountId) throw new DalError("INVALID", "The Stripe account changed. Please try again.");
    const s = await applyAccountState(tx, locked, account, ctx.userId);
    return { slug: locked.slug, ...s };
  });
}

/**
 * System actor (called by the Stripe webhook): sync a connected account's
 * readiness. Unknown accounts are a no-op.
 */
export async function handleAccountUpdated(account: Stripe.Account): Promise<void> {
  if (!account?.id) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(programs)
      .where(eq(programs.stripeAccountId, account.id))
      .limit(1)
      .for("update");
    if (!row) return;
    await applyAccountState(tx, row, account, null);
  });
}

/** Board only: GBYS application fee (flat + percent) for a partner program. */
export async function setPlatformFee(
  ctx: SessionContext,
  programId: string,
  input: PlatformFeeInput
): Promise<{ slug: string }> {
  parseId(programId);
  if (!isBoard(ctx)) throw forbidden();
  const r = platformFeeSchema.safeParse(input);
  if (!r.success) throw new DalError("INVALID", r.error.issues[0]?.message ?? "Invalid input.");
  const { flatCents, bps } = r.data;

  return db.transaction(async (tx) => {
    const p = await loadManaged(ctx, programId, tx, true);
    if (!p.isIndependentPartner) {
      throw new DalError("INVALID", "A platform fee applies only to independent partner programs.");
    }
    if (p.platformFeeCents === flatCents && p.platformFeeBps === bps) return { slug: p.slug };
    await tx
      .update(programs)
      .set({ platformFeeCents: flatCents, platformFeeBps: bps })
      .where(eq(programs.id, p.id));
    await writeAudit(
      {
        actorUserId: ctx.userId,
        action: "program.platform_fee_updated",
        targetType: "program",
        targetId: p.id,
        metadata: {
          from: { flatCents: p.platformFeeCents, bps: p.platformFeeBps },
          to: { flatCents, bps },
        },
      },
      tx
    );
    return { slug: p.slug };
  });
}
