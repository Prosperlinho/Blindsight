import { NextResponse } from "next/server";
import { getGloamQueryRequirements } from "@/lib/gloamServer";
import { GLOAM_NETWORK, GLOAM_QUERY_PRICE_ETH } from "@/lib/gloamConfig";

/**
 * Returns the price and receive tag for one private query.
 *
 * The values are public by design: the amount is the advertised price and the
 * receive tag is the shielded address a payment is sealed to. The receive key
 * that can open the payment never leaves the server.
 */

export async function GET(request: Request) {
  const vaultId = new URL(request.url).searchParams.get("vaultId")?.trim();

  if (!vaultId) {
    return NextResponse.json(
      { success: false, error: "A vault is required.", code: "MISSING_VAULT_ID" },
      { status: 400 },
    );
  }

  try {
    const requirements = getGloamQueryRequirements(vaultId);
    return NextResponse.json(
      {
        success: true,
        requirements,
        display: {
          priceEth: GLOAM_QUERY_PRICE_ETH,
          chainName: GLOAM_NETWORK.label,
          chainId: GLOAM_NETWORK.chainId,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "[Gloam Requirements] Could not build requirements:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        success: false,
        error: "Private payments are unavailable right now.",
        code: "GLOAM_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }
}
