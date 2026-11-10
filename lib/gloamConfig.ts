import { GLOAM_NETWORKS, NATIVE_ASSET } from "@gloamtrade/sdk";
import { parseEther } from "viem";

/**
 * Configuration shared by the browser payment helper and the server.
 *
 * Gloam settles on Robinhood Chain testnet. Keep this module free of Node-only
 * imports so the client bundle can read the same network, pool, and price that
 * the server uses when it builds the payment requirements.
 */

export const GLOAM_NETWORK = GLOAM_NETWORKS.robinhood;

/** Price of one private query, in native ETH on Robinhood Chain testnet. */
export const GLOAM_QUERY_PRICE_ETH = "0.0002";
export const GLOAM_QUERY_PRICE_WEI = parseEther(GLOAM_QUERY_PRICE_ETH);

/** Native ETH, the asset every private query is priced in. */
export const GLOAM_NATIVE_ASSET = NATIVE_ASSET;

/**
 * Off by default. The optional "Pay privately" control is rendered only when
 * this is explicitly enabled after the testnet flow has been verified.
 */
export const GLOAM_UI_ENABLED = process.env.NEXT_PUBLIC_GLOAM_ENABLED === "true";

/** Block explorer link for a settled private transfer. */
export function gloamExplorerTxUrl(txHash: string): string {
  return `${GLOAM_NETWORK.explorerUrl}/tx/${txHash}`;
}
