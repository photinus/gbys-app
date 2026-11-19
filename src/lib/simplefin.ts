/**
 * SimpleFIN Bridge client (https://www.simplefin.org/protocol.html).
 *
 * Pure + fetch: every network call takes an injectable `fetch` so tests can run
 * against a fake server. The access URL embeds basic-auth credentials that can read
 * every bank transaction: this module never logs it and never puts it in an error
 * message. Node's fetch refuses URLs that contain credentials, so they are moved
 * into an `Authorization: Basic` header.
 */

export class SimpleFinError extends Error {
  constructor(
    message: string,
    public kind: "token" | "auth" | "rate_limit" | "payment" | "network" | "protocol" = "protocol"
  ) {
    super(message);
    this.name = "SimpleFinError";
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SimpleFinOptions {
  fetch?: FetchLike;
  /** Permit http:// URLs. Defaults to env rules (see allowInsecureHttp). */
  allowInsecure?: boolean;
  timeoutMs?: number;
}

/**
 * Production requires https. Plain http is for local development and tests: allowed
 * when NODE_ENV is not "production", or when SIMPLEFIN_ALLOW_INSECURE_HTTP=1 is set
 * explicitly (a test override, e.g. a browser smoke run against `next start`).
 */
export function allowInsecureHttp(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.SIMPLEFIN_ALLOW_INSECURE_HTTP === "1";
}

export const MAX_WINDOW_DAYS = 60;
const DAY_SECONDS = 86_400;
const DEFAULT_TIMEOUT_MS = 30_000;

// ---- money -------------------------------------------------------------------

/**
 * Decimal string (or number) -> integer cents without floating-point error.
 * "12.34" -> 1234, "-0.5" -> -50, "1,000.10" -> 100010, "1e3" -> 100000. Fractions beyond
 * two digits are rounded half away from zero. Throws on garbage.
 */
export function parseMoneyToCents(value: unknown): number {
  let s: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SimpleFinError("Invalid amount in bank data.");
    s = /e/i.test(String(value)) ? value.toFixed(8) : String(value);
  } else if (typeof value === "string") {
    s = value.trim().replace(/,/g, "").replace(/^\$/, "").replace(/^([+-])\$/, "$1");
  } else {
    throw new SimpleFinError("Invalid amount in bank data.");
  }
  const exp = /^([+-]?[\d.]+)[eE]([+-]?\d+)$/.exec(s);
  if (exp) s = Number(s).toFixed(8);
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new SimpleFinError("Invalid amount in bank data.");
  const neg = m[1] === "-";
  const whole = Number(m[2] || "0");
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = whole * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) throw new SimpleFinError("Amount in bank data is too large.");
  return neg ? -cents : cents;
}

// ---- setup token / claim -------------------------------------------------------

function isHttpsOrAllowed(url: URL, allowInsecure: boolean): boolean {
  return url.protocol === "https:" || (allowInsecure && url.protocol === "http:");
}

/** Decode a setup token (base64 or base64url of the claim URL) and validate it. */
export function decodeSetupToken(token: string, allowInsecure = allowInsecureHttp()): string {
  const cleaned = token.replace(/\s+/g, "");
  if (!cleaned) throw new SimpleFinError("Paste the SimpleFIN setup token.", "token");
  const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  let decoded: string;
  try {
    decoded = Buffer.from(b64, "base64").toString("utf8").trim();
  } catch {
    throw new SimpleFinError("That doesn't look like a SimpleFIN setup token.", "token");
  }
  let url: URL;
  try {
    url = new URL(decoded);
  } catch {
    throw new SimpleFinError("That doesn't look like a SimpleFIN setup token.", "token");
  }
  if (!isHttpsOrAllowed(url, allowInsecure)) {
    throw new SimpleFinError("The setup token must point to a secure (https) address.", "token");
  }
  if (url.username || url.password) {
    throw new SimpleFinError("That doesn't look like a SimpleFIN setup token.", "token");
  }
  return url.toString();
}

function pickFetch(opts?: SimpleFinOptions): FetchLike {
  return opts?.fetch ?? ((input, init) => fetch(input, init));
}

async function doFetch(f: FetchLike, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new SimpleFinError("SimpleFIN did not respond in time. Try again in a few minutes.", "network");
    }
    // Deliberately not including err.message: fetch errors can echo the URL.
    throw new SimpleFinError("Could not reach SimpleFIN. Try again in a few minutes.", "network");
  }
}

/**
 * Claim a one-time setup token. POSTs (empty body) to the decoded claim URL and returns
 * the access URL (`https://user:pass@host/path`). A token can only be claimed once.
 */
export async function claimSetupToken(token: string, opts: SimpleFinOptions = {}): Promise<string> {
  const allow = opts.allowInsecure ?? allowInsecureHttp();
  const claimUrl = decodeSetupToken(token, allow);
  const res = await doFetch(pickFetch(opts), claimUrl, { method: "POST" }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (res.status === 403 || res.status === 404 || res.status === 400) {
    throw new SimpleFinError(
      "SimpleFIN rejected the setup token. Tokens work only once: create a new one in your SimpleFIN account and try again.",
      "token"
    );
  }
  if (!res.ok) throw new SimpleFinError(`SimpleFIN returned an error (${res.status}). Try again later.`, "network");
  const accessUrl = (await res.text()).trim();
  let u: URL;
  try {
    u = new URL(accessUrl);
  } catch {
    throw new SimpleFinError("SimpleFIN returned an unexpected response.");
  }
  if (!isHttpsOrAllowed(u, allow) || !u.username) {
    throw new SimpleFinError("SimpleFIN returned an unexpected response.");
  }
  return accessUrl;
}

// ---- accounts ------------------------------------------------------------------

export interface SfTransaction {
  id: string;
  /** Posted instant. */
  postedAt: Date;
  amountCents: number;
  description: string;
  payee: string | null;
  memo: string | null;
  pending: boolean;
  raw: Record<string, unknown>;
}

export interface SfAccount {
  id: string;
  name: string;
  currency: string;
  balanceCents: number | null;
  availableBalanceCents: number | null;
  balanceDate: Date | null;
  institution: string | null;
  transactions: SfTransaction[];
}

export interface SfAccountsResult {
  accounts: SfAccount[];
  /** Messages from the bridge (`errors` or `errlist`) — shown to the admin. */
  errors: string[];
}

export interface FetchAccountsParams extends SimpleFinOptions {
  /** Unix seconds, inclusive. */
  startDate?: number;
  /** Unix seconds, exclusive. */
  endDate?: number;
  pending?: boolean;
  balancesOnly?: boolean;
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t ? t : null;
  }
  if (typeof v === "number") return String(v);
  return null;
}

function unixToDate(v: unknown): Date | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  // Tolerate millisecond timestamps.
  return new Date(n > 1e11 ? n : n * 1000);
}

function optMoney(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  try {
    return parseMoneyToCents(v);
  } catch {
    return null;
  }
}

/** Tolerant parse of a /accounts response (protocol 1.x `errors`, 2.x `errlist`/`connections`). */
export function parseAccountsResponse(json: unknown): SfAccountsResult {
  if (!json || typeof json !== "object") throw new SimpleFinError("SimpleFIN returned an unexpected response.");
  const j = json as Record<string, unknown>;

  const errors: string[] = [];
  if (Array.isArray(j.errors)) {
    for (const e of j.errors) {
      const s = typeof e === "string" ? e : str((e as { msg?: unknown })?.msg);
      if (s) errors.push(s);
    }
  }
  if (Array.isArray(j.errlist)) {
    for (const e of j.errlist) {
      const o = e as { code?: unknown; msg?: unknown };
      const msg = str(o?.msg);
      const code = str(o?.code);
      if (msg) errors.push(code ? `${msg} (${code})` : msg);
      else if (code) errors.push(code);
    }
  }

  const connNames = new Map<string, string>();
  if (Array.isArray(j.connections)) {
    for (const c of j.connections) {
      const o = c as { conn_id?: unknown; name?: unknown };
      const id = str(o?.conn_id);
      const name = str(o?.name);
      if (id && name) connNames.set(id, name);
    }
  }

  const accounts: SfAccount[] = [];
  const rawAccounts = Array.isArray(j.accounts) ? j.accounts : [];
  for (const ra of rawAccounts) {
    if (!ra || typeof ra !== "object") continue;
    const a = ra as Record<string, unknown>;
    const id = str(a.id);
    if (!id) continue;
    const org = a.org && typeof a.org === "object" ? (a.org as Record<string, unknown>) : null;
    const connId = str(a.conn_id);
    const institution = (org && (str(org.name) ?? str(org.domain))) || (connId ? (connNames.get(connId) ?? null) : null);

    const txns: SfTransaction[] = [];
    const rawTxns = Array.isArray(a.transactions) ? a.transactions : [];
    for (const rt of rawTxns) {
      if (!rt || typeof rt !== "object") continue;
      const t = rt as Record<string, unknown>;
      const tid = str(t.id);
      if (!tid) continue;
      let amountCents: number;
      try {
        amountCents = parseMoneyToCents(t.amount);
      } catch {
        errors.push(`Skipped a transaction with an unreadable amount (${tid}).`);
        continue;
      }
      const pending = t.pending === true || t.pending === 1 || t.pending === "1" || t.pending === "true";
      const postedAt = unixToDate(t.posted) ?? unixToDate(t["transacted_at"]);
      // A pending transaction may not have a posted time yet; a posted one always does.
      if (!postedAt && !pending) {
        errors.push(`Skipped a transaction without a date (${tid}).`);
        continue;
      }
      const payee = str(t.payee);
      const memo = str(t.memo);
      const description = (str(t.description) ?? payee ?? memo ?? "(no description)").slice(0, 500);
      txns.push({
        id: tid,
        postedAt: postedAt ?? new Date(0),
        amountCents,
        description,
        payee: payee ? payee.slice(0, 500) : null,
        memo: memo ? memo.slice(0, 1000) : null,
        pending,
        raw: t,
      });
    }

    accounts.push({
      id,
      name: (str(a.name) ?? "Account").slice(0, 200),
      currency: (str(a.currency) ?? "USD").slice(0, 10),
      balanceCents: optMoney(a.balance),
      availableBalanceCents: optMoney(a["available-balance"]),
      balanceDate: unixToDate(a["balance-date"]),
      institution: institution ? institution.slice(0, 200) : null,
      transactions: txns,
    });
  }
  return { accounts, errors };
}

/** Split [start, end) into windows of at most MAX_WINDOW_DAYS days. */
export function windowsFor(startDate: number, endDate: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const span = MAX_WINDOW_DAYS * DAY_SECONDS;
  for (let s = startDate; s < endDate; s += span) out.push({ start: s, end: Math.min(s + span, endDate) });
  return out;
}

async function fetchOnce(accessUrl: string, params: FetchAccountsParams, window?: { start: number; end: number }) {
  let u: URL;
  try {
    u = new URL(accessUrl);
  } catch {
    throw new SimpleFinError("The stored SimpleFIN connection is invalid. Disconnect and reconnect it.", "auth");
  }
  const allow = params.allowInsecure ?? allowInsecureHttp();
  if (!isHttpsOrAllowed(u, allow)) throw new SimpleFinError("The SimpleFIN connection must use https.", "auth");
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  u.username = "";
  u.password = "";
  const base = u.toString().replace(/\/+$/, "");
  const q = new URLSearchParams();
  if (window) {
    q.set("start-date", String(Math.floor(window.start)));
    q.set("end-date", String(Math.floor(window.end)));
  }
  if (params.pending) q.set("pending", "1");
  if (params.balancesOnly) q.set("balances-only", "1");
  const qs = q.toString();
  const res = await doFetch(
    pickFetch(params),
    `${base}/accounts${qs ? `?${qs}` : ""}`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
        Accept: "application/json",
      },
    },
    params.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
  if (res.status === 402) throw new SimpleFinError("SimpleFIN says your subscription needs attention (payment required).", "payment");
  if (res.status === 403) {
    throw new SimpleFinError("SimpleFIN no longer accepts this connection. Disconnect it and connect again with a new setup token.", "auth");
  }
  if (res.status === 429) throw new SimpleFinError("SimpleFIN rate limit reached (about 24 requests a day). Try again later.", "rate_limit");
  if (!res.ok) throw new SimpleFinError(`SimpleFIN returned an error (${res.status}). Try again later.`, "network");
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new SimpleFinError("SimpleFIN returned an unexpected response.");
  }
  return parseAccountsResponse(json);
}

/**
 * GET {access}/accounts. With a date range, requests are split into windows of at most
 * 60 days and merged (transactions de-duplicated by id; balances from the last window).
 * Pending transactions are requested only when `pending` is true.
 */
export async function fetchAccounts(accessUrl: string, params: FetchAccountsParams = {}): Promise<SfAccountsResult> {
  if (params.balancesOnly || params.startDate === undefined || params.endDate === undefined) {
    return fetchOnce(accessUrl, params);
  }
  const windows = windowsFor(params.startDate, params.endDate);
  if (windows.length === 0) windows.push({ start: params.startDate, end: params.startDate + DAY_SECONDS });
  const merged = new Map<string, SfAccount>();
  const errors: string[] = [];
  for (const w of windows) {
    const r = await fetchOnce(accessUrl, params, w);
    for (const e of r.errors) if (!errors.includes(e)) errors.push(e);
    for (const a of r.accounts) {
      const prev = merged.get(a.id);
      if (!prev) {
        merged.set(a.id, { ...a, transactions: [...a.transactions] });
        continue;
      }
      const seen = new Set(prev.transactions.map((t) => t.id));
      for (const t of a.transactions) if (!seen.has(t.id)) prev.transactions.push(t);
      merged.set(a.id, { ...a, transactions: prev.transactions });
    }
  }
  return { accounts: [...merged.values()], errors };
}
