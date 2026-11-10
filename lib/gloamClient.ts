import {
  GLOAM_NETWORKS,
  artifactProver,
  buildGloamPayment,
  buildGloamPaymentRequirements,
  buildShieldBoundIntent,
  circuitArtifactUrls,
  syncTree,
  type GloamPaymentRequirements,
  type PoseidonMerklePath,
  type PrivateSendIntent,
  type Prover,
} from "@gloamtrade/sdk";
import { createPublicClient, http, type Address, type Hex, type PublicClient } from "viem";

export const GLOAM_CLIENT_NETWORK = GLOAM_NETWORKS.robinhood;

export function getGloamArtifactProver(circuit: "shield" | "transfer" = "transfer"): Prover {
  const { wasm, zkey } = circuitArtifactUrls(circuit, GLOAM_CLIENT_NETWORK.chainId);
  return artifactProver({ wasm, zkey });
}

export function getGloamPublicClient(rpcUrl = GLOAM_CLIENT_NETWORK.rpcUrl): PublicClient {
  return createPublicClient({
    chain: GLOAM_CLIENT_NETWORK.chain,
    transport: http(rpcUrl),
  });
}

export async function getGloamMerklePath(
  client: PublicClient,
  commitment: Hex,
): Promise<PoseidonMerklePath | null> {
  const tree = await syncTree(client, {
    pool: GLOAM_CLIENT_NETWORK.pool,
    fromBlock: GLOAM_CLIENT_NETWORK.deployBlock,
  });
  return tree.pathForCommitment(commitment);
}

export function getGloamRequirements(vaultId: string, resource: string): GloamPaymentRequirements {
  return buildGloamPaymentRequirements({
    amountWei: BigInt("200000000000000"),
    asset: "0x0000000000000000000000000000000000000000",
    assetSymbol: "ETH",
    payTo: process.env.GLOAM_RECEIVE_KEY ? JSON.parse(process.env.GLOAM_RECEIVE_KEY).tag : "",
    resource,
    description: `Private query for ${vaultId}`,
    network: GLOAM_CLIENT_NETWORK.chainId,
    poolAddress: GLOAM_CLIENT_NETWORK.pool,
  });
}

export async function buildGloamShieldIntent(params: {
  amountWei: bigint;
  asset?: Address;
  client: PublicClient;
}): Promise<PrivateSendIntent | Awaited<ReturnType<typeof buildShieldBoundIntent>>> {
  if (!process.env.GLOAM_RECEIVE_KEY) {
    throw new Error("GLOAM_RECEIVE_KEY is not configured.");
  }

  return buildShieldBoundIntent({
    chainId: GLOAM_CLIENT_NETWORK.chainId,
    poolAddress: GLOAM_CLIENT_NETWORK.pool,
    amountWei: params.amountWei,
    asset: params.asset,
    client: params.client,
    prover: getGloamArtifactProver("shield"),
  });
}

export async function buildClientGloamPayment(params: {
  vaultId: string;
  senderSecretHex: Hex;
  senderNoteAmountWei: bigint;
  path: PoseidonMerklePath;
  issuerTag?: string;
}): Promise<ReturnType<typeof buildGloamPayment>> {
  const requirements = getGloamRequirements(params.vaultId, `blindsight:query:${params.vaultId}`);

  return buildGloamPayment({
    requirements,
    senderSecretHex: params.senderSecretHex,
    senderNoteAmountWei: params.senderNoteAmountWei,
    path: params.path,
    prove: getGloamArtifactProver("transfer"),
    issuerTag: params.issuerTag,
  });
}
