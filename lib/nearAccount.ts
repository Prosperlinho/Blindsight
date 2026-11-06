import { NEAR_TESTNET_RPC_URL } from "@/lib/paymentConfig";

/**
 * Real NEAR testnet account helpers.
 *
 * The browser reads native NEAR balances directly from the public FastNear
 * testnet RPC. There is no local ledger, faucet, or invented balance anywhere
 * in the app.
 */

const YOCTO_PER_NEAR = BigInt(10) ** BigInt(24);

export type NearAccountBalance = {
  accountId: string;
  /** Native balance in yoctoNEAR. */
  yocto: bigint;
  /** Human-readable balance, trimmed to at most four decimals. */
  near: string;
};

type ViewAccountRpcResponse = {
  result?: { amount?: unknown };
  error?: { message?: unknown; cause?: unknown; data?: unknown };
};

/**
 * Validates a NEAR account ID using the protocol's account-ID rules:
 * 2–64 characters, lowercase alphanumerics and `._-`, and no leading,
 * trailing, or consecutive separators. This accepts named testnet accounts
 * (`blindsight-ceeaa6612a.testnet`) and 64-character implicit accounts.
 */
export function isValidNearAccountId(accountId: string): boolean {
  if (typeof accountId !== "string") return false;
  const trimmed = accountId.trim();
  if (trimmed.length < 2 || trimmed.length > 64) return false;
  if (trimmed !== trimmed.toLowerCase()) return false;
  if (!/^[a-z0-9._-]+$/.test(trimmed)) return false;
  if (/^[._-]|[._-]$/.test(trimmed)) return false;
  if (/[._-]{2}/.test(trimmed)) return false;
  return true;
}

/** Formats yoctoNEAR with up to four decimal places, without rounding up. */
export function formatNearBalance(yocto: bigint | string): string {
  let value: bigint;
  try {
    value = typeof yocto === "bigint" ? yocto : BigInt(yocto);
  } catch {
    return "0";
  }

  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / YOCTO_PER_NEAR;
  const fraction = absolute % YOCTO_PER_NEAR;

  if (fraction === BigInt(0)) {
    return `${negative ? "-" : ""}${whole}`;
  }

  const fractionText = fraction
    .toString()
    .padStart(24, "0")
    .slice(0, 4)
    .replace(/0+$/, "");

  return fractionText
    ? `${negative ? "-" : ""}${whole}.${fractionText}`
    : `${negative ? "-" : ""}${whole}`;
}

/**
 * Fetches the native NEAR balance from the public testnet RPC.
 *
 * Throws when the account does not exist yet or the RPC is unavailable, so the
 * UI can show an explicit error instead of a made-up number.
 */
export async function fetchNearBalance(accountId: string): Promise<NearAccountBalance> {
  if (!isValidNearAccountId(accountId)) {
    throw new Error("The connected account is not a valid NEAR account ID.");
  }

  const response = await fetch(NEAR_TESTNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "blindsight-balance",
      method: "query",
      params: {
        request_type: "view_account",
        finality: "final",
        account_id: accountId,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`NEAR RPC returned HTTP ${response.status} while reading the balance.`);
  }

  const payload = await response.json() as ViewAccountRpcResponse;
  if (payload.error) {
    const message = typeof payload.error.message === "string"
      ? payload.error.message
      : "NEAR RPC could not read this account.";
    throw new Error(message);
  }

  const rawAmount = payload.result?.amount;
  if (typeof rawAmount !== "string" && typeof rawAmount !== "number") {
    throw new Error("NEAR RPC returned an incomplete account balance.");
  }

  const yocto = BigInt(rawAmount);
  return {
    accountId,
    yocto,
    near: formatNearBalance(yocto),
  };
}
