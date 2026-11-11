import "server-only";

import { JsonRpcProvider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { NEAR_TESTNET_RPC_URL } from "@/lib/paymentConfig";
import {
  OWNERSHIP_NONCE_BYTES,
  OWNERSHIP_RECIPIENT,
  UNPUBLISH_SIGNATURE_MAX_AGE_MS,
  parseUnpublishMessage,
} from "@/lib/vaultOwnership";

export class VaultOwnershipError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 403) {
    super(message);
    this.name = "VaultOwnershipError";
    this.code = code;
    this.status = status;
  }
}

export type UnpublishProof = {
  vaultId: string;
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
  message: string;
};

let provider: JsonRpcProvider | null = null;

function getProvider() {
  provider ??= new JsonRpcProvider({ url: NEAR_TESTNET_RPC_URL });
  return provider;
}

/**
 * Checks that `proof` is a fresh NEP-413 signature, made with a full-access key
 * of `proof.accountId`, over the unpublish message for `proof.vaultId`.
 * Matching the account to the vault's publisher is the caller's job.
 */
export async function verifyUnpublishProof(proof: UnpublishProof): Promise<void> {
  const parsed = parseUnpublishMessage(proof.message);
  if (!parsed || parsed.vaultId !== proof.vaultId) {
    throw new VaultOwnershipError("The signed message does not match this vault.", "MESSAGE_MISMATCH", 400);
  }

  const age = Date.now() - parsed.issuedAt;
  if (age > UNPUBLISH_SIGNATURE_MAX_AGE_MS || age < -60_000) {
    throw new VaultOwnershipError("The signature has expired. Please try again.", "SIGNATURE_EXPIRED", 400);
  }

  const nonce = Buffer.from(proof.nonce, "base64");
  const signature = Buffer.from(proof.signature, "base64");
  if (nonce.length !== OWNERSHIP_NONCE_BYTES || signature.length !== 64) {
    throw new VaultOwnershipError("The signature is malformed.", "SIGNATURE_MALFORMED", 400);
  }

  try {
    await verifyMessage({
      signerAccountId: proof.accountId,
      signerPublicKey: proof.publicKey,
      payload: { message: proof.message, recipient: OWNERSHIP_RECIPIENT, nonce },
      signature,
      provider: getProvider(),
    });
  } catch (error) {
    // Covers a bad signature, an unknown key, and a key without full access.
    console.warn("[Published Vaults] Ownership signature rejected:", {
      stage: "ownership-verification",
      reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
    throw new VaultOwnershipError("Your wallet signature couldn't be verified.", "SIGNATURE_INVALID");
  }
}
