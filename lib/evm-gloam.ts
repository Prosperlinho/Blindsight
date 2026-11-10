"use client";

import {
  NATIVE_ASSET,
  POOL_STATE_ABI,
  POOL_TRANSFER_ABI,
  artifactProver,
  buildGloamPayment,
  buildShieldBoundIntent,
  circuitArtifactUrls,
  gloamReadTransport,
  syncTree,
  transferCallArgs,
  type GloamPaymentPayload,
  type GloamPaymentRequirements,
} from "@gloamtrade/sdk";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  parseEther,
  type Account,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { GLOAM_NETWORK, GLOAM_NATIVE_ASSET } from "@/lib/gloamConfig";

/**
 * Browser-side Gloam private payment helper.
 *
 * A private query is a real shielded transfer on Robinhood Chain testnet:
 *
 *   1. The buyer shields ETH into the Gloam pool once (a public deposit).
 *   2. For each question the buyer spends that note in a zero-knowledge
 *      transfer to BlindSight's receive tag, keeping the change private.
 *   3. The server opens the sealed payment, sweeps it into a note only it
 *      knows, and unlocks the answer.
 *
 * The note secret is the spend authority. It never leaves the browser except
 * inside the sealed ticket, which only BlindSight's receive key can open.
 */

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

const NOTE_STORAGE_PREFIX = "blindsight:gloam-notes";
const MIN_SHIELD_ETH = "0.0004";

/** Minimal ABI for the hardened deposit call used by Gloam pools. */
const SHIELD_BOUND_ABI = [
  {
    type: "function",
    name: "shieldBound",
    stateMutability: "payable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "commitment", type: "bytes32" },
      { name: "proof", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export type GloamStoredNote = {
  secret: Hex;
  commitment: Hex;
  amountWei: string;
  asset: Address;
  chainId: number;
  createdAt: number;
  /** Saved before its transaction was sent; not spendable until confirmed. */
  pending?: boolean;
  /** For a pending change note: the note its transaction spends. */
  replaces?: Hex;
};

export type GloamEvmConnection = {
  address: Address;
  walletClient: WalletClient<Transport, Chain, Account>;
  publicClient: PublicClient;
};

export class GloamNoBalanceError extends Error {
  constructor() {
    super("Add a private balance before paying privately.");
    this.name = "GloamNoBalanceError";
  }
}

export function hasInjectedEvmWallet(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

function noteStorageKey(address: string): string {
  return `${NOTE_STORAGE_PREFIX}:${GLOAM_NETWORK.chainId}:${address.toLowerCase()}`;
}

function isStoredNote(value: unknown): value is GloamStoredNote {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Partial<GloamStoredNote>;
  return typeof note.secret === "string"
    && note.secret.startsWith("0x")
    && typeof note.commitment === "string"
    && note.commitment.startsWith("0x")
    && typeof note.amountWei === "string"
    && /^\d+$/.test(note.amountWei)
    && typeof note.asset === "string"
    && note.asset.startsWith("0x")
    && note.chainId === GLOAM_NETWORK.chainId;
}

export function loadGloamNotes(address: string): GloamStoredNote[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(noteStorageKey(address));
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredNote);
  } catch {
    return [];
  }
}

function saveGloamNotes(address: string, notes: GloamStoredNote[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(noteStorageKey(address), JSON.stringify(notes));
}

function addGloamNote(address: string, note: GloamStoredNote): void {
  const existing = loadGloamNotes(address).filter(
    (entry) => entry.commitment.toLowerCase() !== note.commitment.toLowerCase(),
  );
  saveGloamNotes(address, [...existing, note]);
}

function removeGloamNote(address: string, commitment: Hex): void {
  const remaining = loadGloamNotes(address).filter(
    (entry) => entry.commitment.toLowerCase() !== commitment.toLowerCase(),
  );
  saveGloamNotes(address, remaining);
}

function confirmGloamNote(address: string, note: GloamStoredNote): void {
  const confirmed: GloamStoredNote = { ...note };
  delete confirmed.pending;
  delete confirmed.replaces;
  saveGloamNotes(
    address,
    loadGloamNotes(address)
      .filter((entry) => entry.commitment.toLowerCase() !== note.replaces?.toLowerCase())
      .map((entry) => (
        entry.commitment.toLowerCase() === note.commitment.toLowerCase() ? confirmed : entry
      )),
  );
}

async function assertTransactionSucceeded(publicClient: PublicClient, hash: Hex): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The transaction was not accepted by the network.");
}

/**
 * Finish notes left pending by a closed tab: a note the pool has seen is real,
 * even if the page never heard back about its transaction.
 */
async function reconcilePendingGloamNotes(address: string, publicClient: PublicClient): Promise<void> {
  for (const note of loadGloamNotes(address).filter((entry) => entry.pending)) {
    const seen = await publicClient.readContract({
      address: GLOAM_NETWORK.pool,
      abi: POOL_STATE_ABI,
      functionName: "commitmentSeen",
      args: [note.commitment],
    }).catch(() => false);
    if (seen) confirmGloamNote(address, note);
  }
}

function toHexChainId(chainId: number): Hex {
  return `0x${chainId.toString(16)}`;
}

async function ensureGloamChain(provider: EIP1193Provider): Promise<void> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHexChainId(GLOAM_NETWORK.chainId) }],
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? Number((error as { code?: unknown }).code)
      : undefined;
    // 4902: the wallet does not know this chain yet.
    if (code !== 4902) throw error;

    const explorer = GLOAM_NETWORK.chain.blockExplorers?.default.url;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: toHexChainId(GLOAM_NETWORK.chainId),
        chainName: GLOAM_NETWORK.chain.name,
        nativeCurrency: GLOAM_NETWORK.chain.nativeCurrency,
        rpcUrls: [...GLOAM_NETWORK.chain.rpcUrls.default.http],
        blockExplorerUrls: explorer ? [explorer] : [],
      }],
    });
  }
}

/**
 * Connect the buyer's EVM wallet and put it on Robinhood Chain testnet.
 * `requestAddresses` opens the wallet's account prompt.
 */
export async function connectGloamWallet(): Promise<GloamEvmConnection> {
  if (typeof window === "undefined") {
    throw new Error("A wallet can only be connected in the browser.");
  }
  const injected = window.ethereum;
  if (!injected) {
    throw new Error("Install an EVM wallet such as MetaMask to pay privately.");
  }

  await ensureGloamChain(injected);

  const walletClient = createWalletClient({
    chain: GLOAM_NETWORK.chain,
    transport: custom(injected),
  });
  const [address] = await walletClient.requestAddresses();
  if (!address) throw new Error("The wallet did not share an account.");

  const accountClient = createWalletClient({
    account: address,
    chain: GLOAM_NETWORK.chain,
    transport: custom(injected),
  });

  const publicClient = createPublicClient({
    chain: GLOAM_NETWORK.chain,
    transport: gloamReadTransport(GLOAM_NETWORK),
  });

  await reconcilePendingGloamNotes(address, publicClient as PublicClient);

  return {
    address,
    walletClient: accountClient as WalletClient<Transport, Chain, Account>,
    publicClient: publicClient as PublicClient,
  };
}

export function getGloamPrivateBalance(address: string): bigint {
  return loadGloamNotes(address).filter((note) => !note.pending).reduce(
    (total, note) => total + BigInt(note.amountWei),
    BigInt(0),
  );
}

/** Human-readable private balance, for example "0.0018". */
export function formatGloamBalance(address: string): string {
  return formatEther(getGloamPrivateBalance(address));
}

/**
 * Shield native ETH into the Gloam pool. The deposit is public; the note it
 * mints is not, and it is the balance later questions spend from.
 */
export async function shieldGloamEth({
  connection,
  amountEth,
}: {
  connection: GloamEvmConnection;
  amountEth: string;
}): Promise<{ note: GloamStoredNote; txHash: Hex }> {
  const amountWei = parseEther(amountEth);
  if (amountWei < parseEther(MIN_SHIELD_ETH)) {
    throw new Error(`Add at least ${MIN_SHIELD_ETH} ETH to your private balance.`);
  }

  const intent = await buildShieldBoundIntent({
    chainId: GLOAM_NETWORK.chainId,
    poolAddress: GLOAM_NETWORK.pool,
    asset: NATIVE_ASSET,
    amountWei,
    prover: artifactProver(circuitArtifactUrls("shield", GLOAM_NETWORK.chainId)),
    client: connection.publicClient,
  });

  const note: GloamStoredNote = {
    secret: intent.note.secret,
    commitment: intent.note.commitment,
    amountWei: amountWei.toString(),
    asset: NATIVE_ASSET,
    chainId: GLOAM_NETWORK.chainId,
    createdAt: Date.now(),
    pending: true,
  };
  // The secret is the money: it must be on disk before the deposit can land.
  addGloamNote(connection.address, note);

  let txHash: Hex;
  try {
    txHash = await connection.walletClient.writeContract({
      account: connection.address,
      chain: GLOAM_NETWORK.chain,
      address: intent.exec.poolAddress,
      abi: SHIELD_BOUND_ABI,
      functionName: "shieldBound",
      args: intent.exec.args as readonly [Address, bigint, Hex, Hex],
      value: intent.exec.valueWei,
    });
  } catch (error) {
    removeGloamNote(connection.address, note.commitment);
    throw error;
  }

  await assertTransactionSucceeded(connection.publicClient, txHash);
  confirmGloamNote(connection.address, note);

  return { note, txHash };
}

/** Ask the server what this vault costs on the private rail. */
export async function fetchGloamRequirements(vaultId: string): Promise<GloamPaymentRequirements> {
  const response = await fetch(
    `/api/gloam/requirements?vaultId=${encodeURIComponent(vaultId)}`,
    { cache: "no-store" },
  );
  const result = await response.json().catch(() => ({})) as {
    requirements?: GloamPaymentRequirements;
    error?: string;
  };
  if (!response.ok || !result.requirements) {
    throw new Error(result.error || "Private payments are unavailable right now.");
  }
  return result.requirements;
}

export type GloamQueryPayment = {
  payload: GloamPaymentPayload;
  txHash: Hex;
  amountWei: string;
};

/**
 * Spend a private note on one question. Returns the sealed payment payload the
 * answer endpoint expects. The source note is retired once the transfer
 * confirms, so a failed request cannot accidentally spend it twice.
 */
export async function payQueryWithGloam({
  connection,
  vaultId,
  requirements,
}: {
  connection: GloamEvmConnection;
  vaultId: string;
  requirements?: GloamPaymentRequirements;
}): Promise<GloamQueryPayment> {
  const paymentRequirements = requirements ?? await fetchGloamRequirements(vaultId);
  const requiredWei = BigInt(paymentRequirements.maxAmountRequired);
  const nativeAsset = GLOAM_NATIVE_ASSET.toLowerCase();

  const candidates = loadGloamNotes(connection.address)
    .filter((note) => (
      !note.pending
      && note.asset.toLowerCase() === nativeAsset
      && BigInt(note.amountWei) >= requiredWei
    ))
    .sort((left, right) => (
      BigInt(left.amountWei) < BigInt(right.amountWei) ? -1 : 1
    ));

  const note = candidates[0];
  if (!note) throw new GloamNoBalanceError();

  const synced = await syncTree(connection.publicClient, {
    pool: GLOAM_NETWORK.pool,
    fromBlock: GLOAM_NETWORK.deployBlock,
  });
  const path = await synced.pathForCommitment(note.commitment);
  if (!path) {
    throw new Error("Your private balance is still confirming. Try again in a moment.");
  }

  const payment = await buildGloamPayment({
    requirements: paymentRequirements,
    senderSecretHex: note.secret,
    senderNoteAmountWei: BigInt(note.amountWei),
    path,
    prove: artifactProver(circuitArtifactUrls("transfer", GLOAM_NETWORK.chainId)),
  });

  // Save the change before sending: once the transfer lands, this is the only
  // record of the remaining balance.
  const hasChange = BigInt(payment.changeNote.amountWei) > BigInt(0);
  const changeNote: GloamStoredNote = {
    secret: payment.changeNote.secret,
    commitment: payment.changeNote.commitment,
    amountWei: payment.changeNote.amountWei,
    asset: payment.changeNote.asset,
    chainId: GLOAM_NETWORK.chainId,
    createdAt: Date.now(),
    pending: true,
    replaces: note.commitment,
  };
  if (hasChange) addGloamNote(connection.address, changeNote);

  let txHash: Hex;
  try {
    txHash = await connection.walletClient.writeContract({
      account: connection.address,
      chain: GLOAM_NETWORK.chain,
      address: payment.intent.exec.poolAddress,
      abi: POOL_TRANSFER_ABI,
      functionName: "transfer",
      args: transferCallArgs(payment.intent),
    });
  } catch (error) {
    if (hasChange) removeGloamNote(connection.address, changeNote.commitment);
    throw error;
  }

  payment.payload.payload.txHash = txHash;
  await assertTransactionSucceeded(connection.publicClient, txHash);

  if (hasChange) confirmGloamNote(connection.address, changeNote);
  else removeGloamNote(connection.address, note.commitment);

  return {
    payload: payment.payload,
    txHash,
    amountWei: paymentRequirements.maxAmountRequired,
  };
}
