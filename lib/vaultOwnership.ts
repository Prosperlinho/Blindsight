/**
 * Message format a publisher signs (NEP-413) to prove they own a vault before
 * unpublishing it. Shared by the browser, which asks the wallet to sign it, and
 * the server, which rebuilds and verifies it.
 */
export const OWNERSHIP_RECIPIENT = "BlindSight";
export const UNPUBLISH_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
export const OWNERSHIP_NONCE_BYTES = 32;

const MESSAGE_PREFIX = "Unpublish BlindSight vault ";
const ISSUED_AT_PREFIX = "Issued at: ";

export function buildUnpublishMessage(vaultId: string, issuedAt: string): string {
  return `${MESSAGE_PREFIX}${vaultId}\n${ISSUED_AT_PREFIX}${issuedAt}`;
}

export function parseUnpublishMessage(message: string): { vaultId: string; issuedAt: number } | null {
  const [first, second, ...rest] = message.split("\n");
  if (rest.length || !first?.startsWith(MESSAGE_PREFIX) || !second?.startsWith(ISSUED_AT_PREFIX)) return null;
  const vaultId = first.slice(MESSAGE_PREFIX.length);
  const issuedAtText = second.slice(ISSUED_AT_PREFIX.length);
  const issuedAt = Date.parse(issuedAtText);
  if (!vaultId || !Number.isFinite(issuedAt)) return null;
  if (buildUnpublishMessage(vaultId, issuedAtText) !== message) return null;
  return { vaultId, issuedAt };
}
