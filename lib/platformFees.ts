/**
 * BlindSight platform fees.
 *
 * - Query fee: paid by the buyer on top of the vault's price, per question.
 * - Publishing fee: paid once by the publisher when a vault goes live.
 *
 * Both are native NEAR testnet transfers to the platform treasury. Values come
 * from NEXT_PUBLIC_* variables so the browser (which builds the payment) and
 * the server (which verifies it) always agree. Setting a fee to "0" turns it off.
 *
 * Safe to import from client and server code.
 */
import { getTreasuryAccount, nearToYocto, yoctoToNearAmount } from "@/lib/paymentConfig";

export const DEFAULT_QUERY_FEE_NEAR = "0.01";
export const DEFAULT_PUBLISH_FEE_NEAR = "0.05";
const MAX_FEE_NEAR = "1";

function isValidAccountId(accountId: string) {
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(accountId) && !/[._-]{2}/.test(accountId);
}

/** Account that receives platform fees. Defaults to the BlindSight treasury. */
export function getPlatformTreasury(): string {
  const configured = process.env.NEXT_PUBLIC_BLINDSIGHT_PLATFORM_TREASURY?.trim() ?? "";
  return isValidAccountId(configured) ? configured : getTreasuryAccount();
}

function resolveFee(configured: string | undefined, fallback: string): string {
  const value = configured?.trim();
  if (!value) return fallback;
  if (/^0+(\.0+)?$/.test(value)) return "0";
  try {
    const yocto = nearToYocto(value);
    if (yocto > nearToYocto(MAX_FEE_NEAR)) return fallback;
    return yoctoToNearAmount(yocto);
  } catch {
    return fallback;
  }
}

/** Platform fee added to every paid question, in NEAR ("0" when disabled). */
export function getQueryFeeNear(): string {
  return resolveFee(process.env.NEXT_PUBLIC_BLINDSIGHT_QUERY_FEE_NEAR, DEFAULT_QUERY_FEE_NEAR);
}

/** One-time fee to publish a vault, in NEAR ("0" when disabled). */
export function getPublishFeeNear(): string {
  return resolveFee(process.env.NEXT_PUBLIC_BLINDSIGHT_PUBLISH_FEE_NEAR, DEFAULT_PUBLISH_FEE_NEAR);
}

export function isFeeEnabled(feeNear: string): boolean {
  return feeNear !== "0";
}

export function feeToYocto(feeNear: string): bigint {
  return isFeeEnabled(feeNear) ? nearToYocto(feeNear) : BigInt(0);
}

/** Exact NEAR addition without floating point, e.g. "0.15" + "0.01" = "0.16". */
export function addNearAmounts(...amounts: string[]): string {
  const total = amounts.reduce((sum, amount) => sum + feeToYocto(amount), BigInt(0));
  return yoctoToNearAmount(total);
}
