import { NextResponse } from "next/server";
import {
  createPublishedVault,
  deletePublishedVault,
  getPublishedVault,
  listPublishedVaults,
  PublishFeeAlreadyUsedError,
  PublishedVaultStorageError,
} from "@/lib/publishedVaults";
import { PaymentVerificationError, verifyNearTransfer } from "@/lib/paymentVerification";
import { feeToYocto, getPlatformTreasury, getPublishFeeNear, isFeeEnabled } from "@/lib/platformFees";
import { VaultOwnershipError, verifyUnpublishProof, type UnpublishProof } from "@/lib/verifyVaultOwner";

const PROOF_FIELDS = ["vaultId", "accountId", "publicKey", "signature", "nonce", "message"] as const;

/**
 * Unpublishes a vault. The caller must prove they control the publisher's
 * NEAR account with a fresh NEP-413 signature over the unpublish message.
 */
export async function DELETE(request: Request) {
  let proof: UnpublishProof;
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null) throw new Error("invalid body");
    const body = value as Record<string, unknown>;
    if (PROOF_FIELDS.some((field) => typeof body[field] !== "string" || !body[field])) throw new Error("missing field");
    proof = Object.fromEntries(PROOF_FIELDS.map((field) => [field, body[field]])) as UnpublishProof;
  } catch {
    return NextResponse.json({ error: "Invalid unpublish request." }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const record = await getPublishedVault(proof.vaultId);
    if (!record) {
      // Sample vaults and unknown ids land here, so they can never be removed.
      return NextResponse.json({ error: "This vault no longer exists." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (record.publisherAddress !== proof.accountId) {
      console.warn("[Published Vaults] Unpublish rejected: signer is not the publisher.", { stage: "ownership-check" });
      return NextResponse.json(
        { error: "Only the account that published this vault can unpublish it.", code: "NOT_PUBLISHER" },
        { status: 403, headers: PRIVATE_HEADERS },
      );
    }

    await verifyUnpublishProof(proof);
    await deletePublishedVault(record);
    return NextResponse.json({ vaultId: record.id }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof VaultOwnershipError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: PRIVATE_HEADERS });
    }
    console.error(
      "[Published Vaults] Unpublishing failed:",
      error instanceof PublishedVaultStorageError
        ? { stage: error.stage, code: error.code, status: error.status }
        : error instanceof Error ? { name: error.name, message: error.message } : "unknown error",
    );
    return NextResponse.json(
      {
        error: "Couldn't unpublish this vault right now. Please try again.",
        ...(error instanceof PublishedVaultStorageError ? { stage: error.stage, code: error.code } : {}),
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export const maxDuration = 60;

const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const vaults = await listPublishedVaults();
    return NextResponse.json({ vaults }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error(
      "[Published Vaults] Listing failed:",
      error instanceof PublishedVaultStorageError
        ? { stage: error.stage, code: error.code, status: error.status }
        : error instanceof Error ? { name: error.name, message: error.message } : "unknown storage error",
    );
    return NextResponse.json(
      {
        error: "Published vaults are temporarily unavailable.",
        ...(error instanceof PublishedVaultStorageError ? { stage: error.stage, code: error.code } : {}),
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return NextResponse.json({ error: "Invalid vault details." }, { status: 400 });
    }
    body = value as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid vault details." }, { status: 400 });
  }

  const { title, description, priceNear, publisherAddress, payoutAddress, dataset } = body;
  if ([title, description, priceNear, publisherAddress, payoutAddress, dataset].some((value) => typeof value !== "string")) {
    return NextResponse.json({ error: "Complete all required vault details." }, { status: 400 });
  }

  // One-time publishing fee: a transfer from the publisher's own account to the
  // platform treasury, verified on-chain before anything is stored.
  const publishFeeNear = getPublishFeeNear();
  let publishFeeTxHash: string | null = null;
  if (isFeeEnabled(publishFeeNear)) {
    const rawFeeTx = body.publishFeeTxHash;
    if (typeof rawFeeTx !== "string" || !rawFeeTx.trim()) {
      return NextResponse.json(
        { error: "The publishing fee payment is missing.", code: "MISSING_PUBLISH_FEE" },
        { status: 402, headers: PRIVATE_HEADERS },
      );
    }
    try {
      const fee = await verifyNearTransfer({
        txHash: rawFeeTx,
        payerAccountId: publisherAddress as string,
        expectedReceiver: getPlatformTreasury(),
        minimumYocto: feeToYocto(publishFeeNear),
      });
      publishFeeTxHash = fee.txHash;
      console.info("[Published Vaults] Publishing fee verified.", { stage: "publish-fee" });
    } catch (error) {
      if (error instanceof PaymentVerificationError) {
        console.warn("[Published Vaults] Publishing fee rejected:", { stage: "publish-fee", code: error.code });
        return NextResponse.json(
          { error: error.message, code: `PUBLISH_FEE_${error.code}` },
          { status: error.status, headers: PRIVATE_HEADERS },
        );
      }
      throw error;
    }
  }

  try {
    const vault = await createPublishedVault({
      title: title as string,
      description: description as string,
      priceNear: priceNear as string,
      publisherAddress: publisherAddress as string,
      payoutAddress: payoutAddress as string,
      dataset: dataset as string,
      publishFeeTxHash,
    });
    return NextResponse.json({ vault }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof PublishFeeAlreadyUsedError) {
      return NextResponse.json(
        { error: error.message, code: "PUBLISH_FEE_ALREADY_USED" },
        { status: 409, headers: PRIVATE_HEADERS },
      );
    }
    const message = error instanceof Error ? error.message : "Unable to publish this vault.";
    const storageError = error instanceof PublishedVaultStorageError;
    console.error(
      "[Published Vaults] Publishing failed:",
      storageError
        ? { stage: error.stage, code: error.code, status: error.status }
        : error instanceof Error ? { name: error.name, message: error.message } : "unknown storage error",
    );
    const status = storageError ? 503 : 400;
    const userMessage = storageError
      ? process.env.NODE_ENV === "production"
        ? "Publishing is temporarily unavailable."
        : `Publishing is temporarily unavailable (${error.stage}: ${error.code}).`
      : message;
    return NextResponse.json(
      {
        error: userMessage,
        ...(storageError ? { stage: error.stage, code: error.code } : {}),
      },
      { status, headers: PRIVATE_HEADERS },
    );
  }
}