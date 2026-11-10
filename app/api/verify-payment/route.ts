import { NextResponse } from "next/server";
import { getDemoVault } from "@/lib/demoVaults";
import { getPublishedVault } from "@/lib/publishedVaults";
import { getTreasuryAccount, nearToYocto } from "@/lib/paymentConfig";
import {
  PaymentVerificationError,
  verifyNearTransfer,
} from "@/lib/paymentVerification";

/**
 * Confirm a wallet transfer on NEAR testnet before the UI reports payment.
 * The query endpoint independently verifies the same transaction before inference.
 */

export const maxDuration = 60;

type Body = {
  txHash?: unknown;
  payerAccountId?: unknown;
  vaultId?: unknown;
  queryPrice?: unknown;
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