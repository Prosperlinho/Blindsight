import { NextResponse } from "next/server";
import { getDemoVault } from "@/lib/demoVaults";
import { gloamExplorerTxUrl } from "@/lib/gloamConfig";
import { settleGloamQueryPayment } from "@/lib/gloamServer";
import { getPublishedVault } from "@/lib/publishedVaults";
import { getTreasuryAccount, nearToYocto } from "@/lib/paymentConfig";
import {
  PaymentVerificationError,
  verifyNearTransfer,
} from "@/lib/paymentVerification";

/**
 * Step 2 of the paid-query flow: confirm that the wallet's transfer really
 * landed on NEAR testnet before the UI says "payment confirmed".
 *
 * The client calls this immediately after signing, then calls
 * `/api/query-tee` with the same transaction hash. The second call re-verifies
 * the transfer so the answer endpoint never trusts the intermediate response.
 */

export const maxDuration = 60;

type Body = {
  txHash?: unknown;
  payerAccountId?: unknown;
  vaultId?: unknown;
  queryPrice?: unknown;
  paymentType?: unknown;
  rail?: unknown;
  payload?: unknown;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON.", code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
  const payerAccountId = typeof body.payerAccountId === "string" ? body.payerAccountId.trim() : "";
  const vaultId = typeof body.vaultId === "string" ? body.vaultId.trim() : "";
  const paymentType = (typeof body.paymentType === "string" ? body.paymentType : typeof body.rail === "string" ? body.rail : "").toUpperCase();
  const payload = body.payload;

  if (paymentType === "GLOAM" || (payload !== undefined && payload !== null)) {
    if (!vaultId) {
      return NextResponse.json(
        { success: false, error: "A vault is required to verify a private Gloam payment.", code: "MISSING_VAULT_ID" },
        { status: 400 },
      );
    }

    if (typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json(
        { success: false, error: "The private Gloam payment payload is missing or invalid.", code: "INVALID_GLOAM_PAYLOAD" },
        { status: 400 },
      );
    }

    try {
      const receipt = await settleGloamQueryPayment({ vaultId, payload: payload as Parameters<typeof settleGloamQueryPayment>[0]["payload"] });
      return NextResponse.json({
        success: true,
        verified: true,
        payment: {
          verified: true,
          rail: "GLOAM",
          receiptId: receipt.id,
          txHash: receipt.txHash,
          vaultId: receipt.vaultId,
          resource: receipt.resource,
          amountWei: receipt.amountWei,
          state: receipt.state,
          network: (payload as Record<string, unknown>).network ?? "robinhood",
          verifiedAt: receipt.createdAt,
          explorerUrl: gloamExplorerTxUrl(receipt.txHash),
        },
        expectedPriceNear: "0.0002",
      });
    } catch (error) {
      console.error(
        "[Payment Verification] Gloam settlement failed:",
        error instanceof Error ? error.message : error,
      );
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error: error instanceof Error ? error.message : "Private Gloam payment verification failed.",
          code: "GLOAM_VERIFICATION_FAILED",
        },
        { status: 402 },
      );
    }
  }

  if (!txHash) {
    return NextResponse.json(
      {
        success: false,
        error: "No NEAR transaction hash was supplied. Sign the query payment first.",
        code: "MISSING_TX_HASH",
      },
      { status: 400 },
    );
  }

  if (!payerAccountId) {
    return NextResponse.json(
      {
        success: false,
        error: "The payer NEAR account is required to verify the payment.",
        code: "MISSING_PAYER",
      },
      { status: 400 },
    );
  }

  const demoVault = vaultId ? getDemoVault(vaultId) : undefined;
  let publishedVault: Awaited<ReturnType<typeof getPublishedVault>> = null;
  if (vaultId && !demoVault) {
    try {
      publishedVault = await getPublishedVault(vaultId);
    } catch {
      return NextResponse.json(
        { success: false, error: "Published vaults are temporarily unavailable.", code: "VAULT_STORAGE_UNAVAILABLE" },
        { status: 503 },
      );
    }
    if (!publishedVault) {
      return NextResponse.json(
        { success: false, error: "This vault is no longer available.", code: "VAULT_NOT_FOUND" },
        { status: 404 },
      );
    }
  }
  const priceNear = demoVault?.priceNear
    ?? publishedVault?.priceNear
    ?? (typeof body.queryPrice === "string" || typeof body.queryPrice === "number" ? String(body.queryPrice) : "");

  if (!priceNear) {
    return NextResponse.json(
      {
        success: false,
        error: "A query price is required for payment verification.",
        code: "MISSING_PRICE",
      },
      { status: 400 },
    );
  }

  let minimumYocto: bigint;
  try {
    minimumYocto = nearToYocto(priceNear);
  } catch {
    return NextResponse.json(
      { success: false, error: "The query price is not a valid NEAR amount.", code: "INVALID_PRICE" },
      { status: 400 },
    );
  }

  const receiver = publishedVault?.payoutAddress
    ?? demoVault?.seller
    ?? getTreasuryAccount();

  try {
    const payment = await verifyNearTransfer({
      txHash,
      payerAccountId,
      expectedReceiver: receiver,
      minimumYocto,
    });

    return NextResponse.json({
      success: true,
      verified: true,
      payment,
      expectedPriceNear: priceNear,
      treasury: receiver,
    });
  } catch (error) {
    if (error instanceof PaymentVerificationError) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error: error.message,
          code: error.code,
          expectedPriceNear: priceNear,
          treasury: receiver,
        },
        { status: error.status },
      );
    }

    console.error(
      "[Payment Verification] Unexpected error:",
      error instanceof Error ? error.message : error,
    );

    return NextResponse.json(
      {
        success: false,
        verified: false,
        error: "Payment verification failed unexpectedly. Please retry.",
        code: "VERIFICATION_ERROR",
      },
      { status: 502 },
    );
  }
}
