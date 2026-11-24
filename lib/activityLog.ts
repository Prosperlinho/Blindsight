import "server-only";

/**
 * Admin activity log in Supabase (table `activity_log`, see supabase/schema.sql).
 *
 * Rows are written by the server only after a payment was verified on chain
 * and the answer released (or the vault stored), so the log matches NEAR.
 * Logging never blocks a buyer or publisher: failures are reported and dropped.
 */

const REQUEST_TIMEOUT_MS = 6_000;
const MAX_ROWS = 1_000;

export type ActivityKind = "query" | "publish" | "unpublish";

export type ActivityEntry = {
  kind: ActivityKind;
  accountId: string;
  vaultId?: string | null;
  vaultTitle?: string | null;
  receiverId?: string | null;
  amountNear?: string | null;
  paymentTx?: string | null;
  feeNear?: string | null;
  feeTx?: string | null;
};

export type ActivityRow = {
  id: number;
  kind: ActivityKind;
  account_id: string;
  vault_id: string | null;
  vault_title: string | null;
  receiver_id: string | null;
  amount_near: string | null;
  payment_tx: string | null;
  fee_near: string | null;
  fee_tx: string | null;
  created_at: string;
};

export type AdminVaultRow = {
  id: string;
  title: string;
  price: string;
  publisher_address: string;
  payout_address: string;
  file_reference: string;
  publish_fee_tx?: string | null;
  created_at: string;
};

export class AdminDataError extends Error {
  constructor(readonly stage: string, readonly status?: number) {
    super(`${stage}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "AdminDataError";
  }
}

function getConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? "";
  return url && anonKey ? { url, anonKey } : null;
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const config = getConfig();
  if (!config) throw new AdminDataError("configuration");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${config.url}/rest/v1/${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        ...init.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Appends one entry. Never throws: the user's request must not fail over it. */
export async function recordActivity(entry: ActivityEntry): Promise<void> {
  try {
    const response = await supabaseRequest("activity_log", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        kind: entry.kind,
        account_id: entry.accountId,
        vault_id: entry.vaultId ?? null,
        vault_title: entry.vaultTitle?.slice(0, 200) ?? null,
        receiver_id: entry.receiverId ?? null,
        amount_near: entry.amountNear ?? null,
        payment_tx: entry.paymentTx ?? null,
        fee_near: entry.feeNear ?? null,
        fee_tx: entry.feeTx ?? null,
      }),
    });
    // 409: this transaction is already logged (e.g. a retried request).
    if (!response.ok && response.status !== 409) {
      const body = await response.text().catch(() => "");
      console.error("[Activity Log] Entry not recorded.", {
        kind: entry.kind,
        status: response.status,
        hint: body.includes("activity_log") ? "Run supabase/schema.sql to create activity_log." : undefined,
      });
    }
  } catch (error) {
    console.error("[Activity Log] Entry not recorded.", {
      kind: entry.kind,
      reason: error instanceof Error ? error.name : "unknown",
    });
  }
}

async function readJson<T>(path: string, stage: string): Promise<T> {
  let response: Response;
  try {
    response = await supabaseRequest(path);
  } catch (error) {
    if (error instanceof AdminDataError) throw error;
    throw new AdminDataError(stage);
  }
  if (!response.ok) throw new AdminDataError(stage, response.status);
  return (await response.json()) as T;
}

export async function listActivity(): Promise<ActivityRow[]> {
  return readJson<ActivityRow[]>(
    `activity_log?select=*&order=created_at.desc&limit=${MAX_ROWS}`,
    "activity-read",
  );
}

/** Every live published vault, including the publishing-fee transaction. */
export async function listVaultsForAdmin(): Promise<AdminVaultRow[]> {
  const base = "id,title,price,publisher_address,payout_address,file_reference,created_at";
  try {
    return await readJson<AdminVaultRow[]>(`vaults?select=${base},publish_fee_tx&order=created_at.desc&limit=${MAX_ROWS}`, "vaults-read");
  } catch (error) {
    // Before the publish_fee_tx migration the column doesn't exist yet.
    if (error instanceof AdminDataError && error.status === 400) {
      return readJson<AdminVaultRow[]>(`vaults?select=${base}&order=created_at.desc&limit=${MAX_ROWS}`, "vaults-read");
    }
    throw error;
  }
}
