import "server-only";
import { createHmac, randomBytes } from "node:crypto";

/**
 * Shared state for replay protection and rate limits.
 *
 * With Upstash Redis configured (the Vercel Marketplace integration sets
 * KV_REST_API_URL / KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL / _TOKEN),
 * every server instance sees the same used payments and query history, and
 * both survive cold starts. Without it, state falls back to this instance's
 * memory, which is what BlindSight did before.
 *
 * Talks to Upstash's REST API with fetch, so there is no client dependency.
 */

const KEY_PREFIX = "bs:";
const REQUEST_TIMEOUT_MS = 3_000;

export class SharedStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedStoreError";
  }
}

function redisConfig() {
  const url = (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "").trim().replace(/\/+$/, "");
  const token = (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
  return url && token ? { url, token } : null;
}

export function isSharedStoreConfigured() {
  return redisConfig() !== null;
}

let warnedAboutMemory = false;
function warnMemoryFallback() {
  if (warnedAboutMemory) return;
  warnedAboutMemory = true;
  console.warn("[Shared Store] Redis is not configured; using per-instance memory. Set KV_REST_API_URL and KV_REST_API_TOKEN.");
}

type RedisValue = string | number | null | RedisValue[];

async function redis(command: (string | number)[]): Promise<RedisValue> {
  const config = redisConfig();
  if (!config) throw new SharedStoreError("Redis is not configured.");
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command.map(String)),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SharedStoreError("Redis request failed.");
  }
  const body = await response.json().catch(() => null) as { result?: RedisValue; error?: string } | null;
  if (!response.ok || !body || body.error) {
    throw new SharedStoreError(`Redis returned ${response.status}${body?.error ? `: ${body.error.slice(0, 120)}` : ""}.`);
  }
  return body.result ?? null;
}

/**
 * Secret for hashing query text and account IDs before they become keys or
 * values. With Redis it must be the same on every instance, so it is derived
 * from the Redis token (never stored); otherwise it is random per instance.
 */
const HASH_KEY = (() => {
  const config = redisConfig();
  return config
    ? createHmac("sha256", config.token).update("blindsight:query-hash:v1").digest()
    : randomBytes(32);
})();

export function keyedHash(value: string) {
  return createHmac("sha256", HASH_KEY).update(value).digest("hex");
}

// ─── Payment claims ──────────────────────────────────────────────────────────

const memoryClaims = new Map<string, { status: "pending" | "settled"; expiresAt: number }>();

function memoryClaim(key: string) {
  const claim = memoryClaims.get(key);
  if (claim && claim.expiresAt <= Date.now()) {
    memoryClaims.delete(key);
    return null;
  }
  return claim ?? null;
}

// Atomically: if any key already exists, report its status; otherwise mark all pending.
const CLAIM_SCRIPT = `
for i, key in ipairs(KEYS) do
  local status = redis.call('GET', key)
  if status then return status end
end
for i, key in ipairs(KEYS) do
  redis.call('SET', key, 'pending', 'PX', ARGV[1])
end
return 'claimed'`;

const RELEASE_SCRIPT = `
for i, key in ipairs(KEYS) do
  if redis.call('GET', key) == 'pending' then redis.call('DEL', key) end
end
return 1`;

const paymentKey = (txHash: string) => `${KEY_PREFIX}pay:${txHash}`;

/**
 * Claims every transaction behind one answer together. Returns "claimed", or
 * the existing status if any of them is already pending or settled.
 */
export async function claimPayments(txHashes: string[], pendingTtlMs: number): Promise<"claimed" | "pending" | "settled"> {
  if (isSharedStoreConfigured()) {
    const keys = txHashes.map(paymentKey);
    const result = await redis(["EVAL", CLAIM_SCRIPT, keys.length, ...keys, pendingTtlMs]);
    if (result === "claimed" || result === "pending" || result === "settled") return result;
    throw new SharedStoreError("Unexpected claim result.");
  }
  warnMemoryFallback();
  for (const txHash of txHashes) {
    const existing = memoryClaim(paymentKey(txHash));
    if (existing) return existing.status;
  }
  for (const txHash of txHashes) {
    memoryClaims.set(paymentKey(txHash), { status: "pending", expiresAt: Date.now() + pendingTtlMs });
  }
  return "claimed";
}

export async function settlePayments(txHashes: string[], settledTtlMs: number) {
  if (isSharedStoreConfigured()) {
    await Promise.all(txHashes.map((txHash) => redis(["SET", paymentKey(txHash), "settled", "PX", settledTtlMs])));
    return;
  }
  for (const txHash of txHashes) {
    memoryClaims.set(paymentKey(txHash), { status: "settled", expiresAt: Date.now() + settledTtlMs });
  }
}

/** Releases pending claims (never settled ones) so the buyer can retry. */
export async function releasePayments(txHashes: string[]) {
  if (isSharedStoreConfigured()) {
    const keys = txHashes.map(paymentKey);
    await redis(["EVAL", RELEASE_SCRIPT, keys.length, ...keys]);
    return;
  }
  for (const txHash of txHashes) {
    if (memoryClaim(paymentKey(txHash))?.status === "pending") memoryClaims.delete(paymentKey(txHash));
  }
}

// ─── Payment ↔ question binding ──────────────────────────────────────────────

const memoryBindings = new Map<string, { questionHash: string; expiresAt: number }>();
const bindingKey = (txHash: string) => `${KEY_PREFIX}bind:${txHash}`;

const BIND_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if existing then return existing end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return ARGV[1]`;

/**
 * Ties a payment to the first question asked with it. Returns the bound
 * question hash, which differs from `questionHash` if another question got
 * there first.
 */
export async function bindPaymentToQuestion(txHash: string, questionHash: string, ttlMs: number): Promise<string> {
  if (isSharedStoreConfigured()) {
    const bound = await redis(["EVAL", BIND_SCRIPT, 1, bindingKey(txHash), questionHash, ttlMs]);
    if (typeof bound !== "string") throw new SharedStoreError("Unexpected binding result.");
    return bound;
  }
  const existing = memoryBindings.get(bindingKey(txHash));
  if (existing && existing.expiresAt > Date.now()) return existing.questionHash;
  memoryBindings.set(bindingKey(txHash), { questionHash, expiresAt: Date.now() + ttlMs });
  return questionHash;
}

/** Frees a payment to be used with a different question (after a refusal). */
export async function unbindPayment(txHash: string) {
  if (isSharedStoreConfigured()) {
    await redis(["DEL", bindingKey(txHash)]);
    return;
  }
  memoryBindings.delete(bindingKey(txHash));
}

// ─── Recent query history (anti-probing) ─────────────────────────────────────

type Timestamped = { timestamp: number };
const memoryHistory = new Map<string, { entries: unknown[]; expiresAt: number }>();
const MAX_MEMORY_HISTORY_KEYS = 2_000;
const historyKey = (namespace: string, key: string) => `${KEY_PREFIX}${namespace}:${key}`;

/** Entries recorded under this key within the last `windowMs`. */
export async function readRecent<T extends Timestamped>(namespace: string, key: string, windowMs: number): Promise<T[]> {
  const cutoff = Date.now() - windowMs;
  let entries: unknown[];
  if (isSharedStoreConfigured()) {
    const raw = await redis(["LRANGE", historyKey(namespace, key), 0, -1]);
    entries = Array.isArray(raw)
      ? raw.flatMap((item) => {
        try {
          return typeof item === "string" ? [JSON.parse(item) as unknown] : [];
        } catch {
          return [];
        }
      })
      : [];
  } else {
    const stored = memoryHistory.get(historyKey(namespace, key));
    entries = stored && stored.expiresAt > Date.now() ? stored.entries : [];
  }
  return entries.filter((entry): entry is T => (
    typeof entry === "object" && entry !== null
    && typeof (entry as Timestamped).timestamp === "number"
    && (entry as Timestamped).timestamp >= cutoff
  ));
}

/** Appends an entry, keeping the newest `maxEntries` for `windowMs`. */
export async function pushRecent<T extends Timestamped>(namespace: string, key: string, entry: T, windowMs: number, maxEntries: number) {
  const storeKey = historyKey(namespace, key);
  if (isSharedStoreConfigured()) {
    await redis(["RPUSH", storeKey, JSON.stringify(entry)]);
    await Promise.all([
      redis(["LTRIM", storeKey, -maxEntries, -1]),
      redis(["PEXPIRE", storeKey, windowMs]),
    ]);
    return;
  }
  const cutoff = Date.now() - windowMs;
  const stored = memoryHistory.get(storeKey);
  const entries = (stored && stored.expiresAt > Date.now() ? stored.entries : [])
    .filter((item) => (item as Timestamped).timestamp >= cutoff);
  entries.push(entry);
  memoryHistory.delete(storeKey);
  memoryHistory.set(storeKey, { entries: entries.slice(-maxEntries), expiresAt: Date.now() + windowMs });
  while (memoryHistory.size > MAX_MEMORY_HISTORY_KEYS) {
    const oldest = memoryHistory.keys().next().value;
    if (!oldest) break;
    memoryHistory.delete(oldest);
  }
}
