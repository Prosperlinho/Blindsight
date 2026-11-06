/**
 * Shared payment configuration for the BlindSight demo.
 *
 * The query fee is a real native NEAR transfer on testnet. It is sent to a
 * single treasury account that the server can verify through the public NEAR
 * RPC, which is why the receiver is not the (fictional) vault publisher.
 *
 * This module is safe to import from both client and server code: it only
 * reads public environment variables and never touches a private key.
 */

export const NEAR_NETWORK = "testnet";
export const NEAR_TESTNET_RPC_URL = "https://rpc.testnet.fastnear.com";
export const NEAR_TESTNET_EXPLORER_TX_URL = "https://testnet.nearblocks.io/txns/";

/**
 * Fallback treasury account. It exists on NEAR testnet and is funded, so a
 * fresh clone works without any environment configuration.
 */
export const DEFAULT_TREASURY_ACCOUNT = "blindsight-ceeaa6612a.testnet";

/** A transfer older than this is rejected to reduce replay risk. */
export const PAYMENT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const YOCTO_PER_NEAR = BigInt(10) ** BigInt(24);

export function getTreasuryAccount(): string {
  const configured =
    process.env.NEXT_PUBLIC_BLINDSIGHT_TREASURY_ACCOUNT
    ?? process.env.BLINDSIGHT_TREASURY_ACCOUNT
    ?? "";
  const trimmed = configured.trim();
  return trimmed || DEFAULT_TREASURY_ACCOUNT;
}

export function getTreasuryExplorerUrl(accountId: string = getTreasuryAccount()): string {
  return `https://testnet.nearblocks.io/address/${encodeURIComponent(accountId)}`;
}

export function getTransactionExplorerUrl(transactionHash: string): string {
  return `${NEAR_TESTNET_EXPLORER_TX_URL}${encodeURIComponent(transactionHash)}`;
}

/**
 * Converts a human-readable NEAR amount ("0.05") to yoctoNEAR without
 * floating point maths or a network dependency.
 */
export function nearToYocto(amount: string | number): bigint {
  const raw = typeof amount === "number" ? amount.toString() : amount.trim();
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(raw);
  if (!match) {
    throw new Error("The NEAR amount must be a positive decimal number.");
  }

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(24, "0") || "0");
  const yocto = whole * YOCTO_PER_NEAR + fraction;
  if (yocto <= BigInt(0)) {
    throw new Error("The NEAR amount must be greater than zero.");
  }
  return yocto;
}

/** Formats yoctoNEAR as a trimmed NEAR string, e.g. "0.05". */
export function yoctoToNearAmount(yocto: string | bigint): string {
  const value = typeof yocto === "bigint" ? yocto : BigInt(yocto);
  const whole = value / YOCTO_PER_NEAR;
  const fraction = (value % YOCTO_PER_NEAR)
    .toString()
    .padStart(24, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}
