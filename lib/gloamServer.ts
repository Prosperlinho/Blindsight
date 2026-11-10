import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  NATIVE_ASSET,
  POOL_STATE_ABI,
  artifactProver,
  buildGloamPaymentRequirements,
  circuitArtifactFiles,
  circuitArtifactUrls,
  gloamReadTransport,
  relaySubmitter,
  settleGloamPayment,
  sweepChainFromClient,
  type GloamPaymentPayload,
  type ReceiveKey,
} from "@gloamtrade/sdk";
import { createPublicClient, type Hex } from "viem";
import { getDemoVault } from "@/lib/demoVaults";
import {
  GLOAM_NETWORK,
  GLOAM_QUERY_PRICE_ETH,
  GLOAM_QUERY_PRICE_WEI,
} from "@/lib/gloamConfig";

export { GLOAM_NETWORK, GLOAM_QUERY_PRICE_ETH, GLOAM_QUERY_PRICE_WEI };

type StoredGloamNote = {
  commitment: string;
  secret: string;
  amountWei: string;
  asset: string;
  savedAt: number;
  state: "pending" | "available";
};

export type GloamQueryReceipt = {
  id: string;
  txHash: Hex;
  /** Hash of the sealed note. Only the buyer has it; the txHash is public. */
  paymentFingerprint: string;
  vaultId: string;
  resource: string;
  amountWei: string;
  asset: string;
  createdAt: number;
  state: "settling" | "retryable" | "processing" | "consumed";
  freshCommitment?: string;
};

type GloamStore = {
  notes: StoredGloamNote[];
  receipts: GloamQueryReceipt[];
};

type EncryptedStore = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

const STORE_PATH = resolve(
  process.env.GLOAM_NOTE_STORE_PATH?.trim()
    || join(process.cwd(), ".gloam-data", "notes.enc.json"),
);
const CIRCUIT_CACHE_PATH = resolve(
  process.env.GLOAM_CIRCUIT_CACHE_PATH?.trim()
    || join(tmpdir(), "blindsight-gloam-circuits"),
);

let storeQueue: Promise<void> = Promise.resolve();
let transferProverPromise: ReturnType<typeof loadTransferProver> | undefined;

function emptyStore(): GloamStore {
  return { notes: [], receipts: [] };
}

function getStoreKey(): Buffer {
  const key = process.env.GLOAM_NOTE_STORE_KEY?.trim() ?? "";
  if (!/^[\da-f]{64}$/i.test(key)) {
    throw new Error("Private payment storage is not configured.");
  }
  return Buffer.from(key, "hex");
}

function getStorePath(): string {
  return STORE_PATH;
}

async function readStore(): Promise<GloamStore> {
  let encoded: string;
  try {
    encoded = await readFile(getStorePath(), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return emptyStore();
    }
    throw error;
  }

  const envelope = JSON.parse(encoded) as EncryptedStore;
  if (envelope.version !== 1) throw new Error("Private payment storage has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", getStoreKey(), Buffer.from(envelope.iv, "hex"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as GloamStore;
}

async function writeStore(store: GloamStore): Promise<void> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getStoreKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(store), "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedStore = {
    version: 1,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("base64"),
  };

  await mkdir(dirname(getStorePath()), { recursive: true });
  const temporaryPath = `${getStorePath()}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(envelope), { mode: 0o600 });
  await rename(temporaryPath, getStorePath());
}

async function updateStore<T>(update: (store: GloamStore) => T | Promise<T>): Promise<T> {
  const operation = storeQueue.then(async () => {
    const store = await readStore();
    const result = await update(store);
    await writeStore(store);
    return result;
  });
  storeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function currentStore(): Promise<GloamStore> {
  await storeQueue;
  return readStore();
}

export function getGloamReceiveKey(): ReceiveKey {
  const encoded = process.env.GLOAM_RECEIVE_KEY?.trim();
  if (!encoded) throw new Error("Private payments are not configured.");

  let key: ReceiveKey;
  try {
    key = JSON.parse(encoded) as ReceiveKey;
  } catch {
    throw new Error("Private payments are not configured.");
  }
  if (typeof key.tag !== "string" || !key.privateJwk || typeof key.privateJwk !== "object") {
    throw new Error("Private payments are not configured.");
  }
  return key;
}

export function getGloamQueryResource(vaultId: string): string {
  return `blindsight:query:${vaultId}`;
}

export function getGloamQueryRequirements(vaultId: string) {
  const vault = getDemoVault(vaultId);
  if (!vault) throw new Error("This vault is not available for private payment.");

  return buildGloamPaymentRequirements({
    amountWei: GLOAM_QUERY_PRICE_WEI,
    asset: NATIVE_ASSET,
    assetSymbol: "ETH",
    payTo: getGloamReceiveKey().tag,
    resource: getGloamQueryResource(vaultId),
    description: `Private query for ${vault.title}`,
    network: GLOAM_NETWORK.chainId,
    poolAddress: GLOAM_NETWORK.pool,
  });
}

async function downloadCircuitFile(url: string, localPath: string, expectedSha256: string): Promise<string> {
  try {
    const existing = await readFile(localPath);
    if (createHash("sha256").update(existing).digest("hex") === expectedSha256) return localPath;
  } catch {
    // Missing or incomplete files are fetched again and hash-checked below.
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error("Could not load the private payment proof files.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    throw new Error("The private payment proof files failed integrity verification.");
  }

  await mkdir(dirname(localPath), { recursive: true });
  const temporaryPath = `${localPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, bytes, { mode: 0o600 });
  await rename(temporaryPath, localPath);
  return localPath;
}

async function loadTransferProver() {
  const files = circuitArtifactFiles("transfer", GLOAM_NETWORK.ceremony);
  const urls = circuitArtifactUrls("transfer", GLOAM_NETWORK.chainId);
  const wasmPath = join(CIRCUIT_CACHE_PATH, files.wasm);
  const zkeyPath = join(CIRCUIT_CACHE_PATH, files.zkey);
  const [wasm, zkey] = await Promise.all([
    downloadCircuitFile(urls.wasm, wasmPath, files.sha256.wasm),
    downloadCircuitFile(urls.zkey, zkeyPath, files.sha256.zkey),
  ]);
  return artifactProver({ wasm, zkey });
}

export function getGloamTransferProver() {
  transferProverPromise ??= loadTransferProver();
  return transferProverPromise;
}

export async function getGloamQueryReceipt(receiptId: string): Promise<GloamQueryReceipt | null> {
  const store = await currentStore();
  return store.receipts.find((receipt) => receipt.id === receiptId) ?? null;
}

export async function settleGloamQueryPayment({
  vaultId,
  payload,
}: {
  vaultId: string;
  payload: GloamPaymentPayload;
}): Promise<GloamQueryReceipt> {
  const txHash = payload.payload?.txHash;
  if (typeof txHash !== "string" || !/^0x[\da-f]{64}$/i.test(txHash)) {
    throw new Error("The private payment has not been submitted yet.");
  }

  const requirements = getGloamQueryRequirements(vaultId);
  if (payload.network !== requirements.network) {
    throw new Error("The private payment was made on an unsupported network.");
  }

  const existingStore = await currentStore();
  // Match on the sealed note, never on the txHash alone: the hash is public on
  // chain, so anyone could otherwise replay it to reuse a paid retry.
  const paymentFingerprint = createHash("sha256")
    .update(String(payload.payload?.paymentNote ?? ""))
    .digest("hex");
  const existing = existingStore.receipts.find(
    (receipt) => receipt.paymentFingerprint === paymentFingerprint,
  );
  if (existing) {
    if (existing.vaultId !== vaultId || existing.resource !== requirements.resource) {
      throw new Error("This private payment belongs to a different query.");
    }
    if (existing.state === "retryable") return existing;
    if (existing.state === "settling" && existing.freshCommitment) {
      const publicClient = createPublicClient({
        chain: GLOAM_NETWORK.chain,
        transport: gloamReadTransport(GLOAM_NETWORK),
      });
      const isAvailable = await publicClient.readContract({
        address: GLOAM_NETWORK.pool,
        abi: POOL_STATE_ABI,
        functionName: "commitmentSeen",
        args: [existing.freshCommitment as Hex],
      });
      if (isAvailable) {
        await updateStore((store) => {
          store.receipts = store.receipts.map((entry) => entry.id === existing.id
            ? { ...entry, state: "retryable" }
            : entry);
          store.notes = store.notes.map((note) => note.commitment === existing.freshCommitment
            ? { ...note, state: "available" }
            : note);
        });
        return { ...existing, state: "retryable" };
      }
      throw new Error("The private payment is still confirming. Try again shortly.");
    }
    throw new Error("This private payment is already being used.");
  }

  const publicClient = createPublicClient({
    chain: GLOAM_NETWORK.chain,
    transport: gloamReadTransport(GLOAM_NETWORK),
  });
  const receipt: GloamQueryReceipt = {
    id: randomBytes(24).toString("base64url"),
    txHash,
    paymentFingerprint,
    vaultId,
    resource: requirements.resource,
    amountWei: GLOAM_QUERY_PRICE_WEI.toString(),
    asset: NATIVE_ASSET,
    createdAt: Date.now(),
    state: "settling",
  };

  await updateStore((store) => {
    store.receipts.push(receipt);
  });

  // An unconfirmed sweep may still land: keep its fresh note and receipt so the
  // buyer can retry without paying again. Every other failure is safe to drop.
  let retainReceipt = false;

  try {
    const result = await settleGloamPayment({
      requirements,
      payload,
      receiveKey: getGloamReceiveKey(),
      prove: await getGloamTransferProver(),
      chain: sweepChainFromClient(publicClient, {
        pool: GLOAM_NETWORK.pool,
        fromBlock: GLOAM_NETWORK.deployBlock,
      }),
      submit: relaySubmitter(),
      beforeSubmit: async (freshNote) => {
        await updateStore((store) => {
          store.receipts = store.receipts.map((entry) => entry.id === receipt.id
            ? { ...entry, freshCommitment: freshNote.commitment }
            : entry);
          store.notes = store.notes.filter((note) => note.commitment !== freshNote.commitment);
          store.notes.push({ ...freshNote, savedAt: Date.now(), state: "pending" });
        });
      },
    });

    if (!result.grantAccess || !result.freshNote) {
      if (result.status === "unconfirmed" && result.freshNote) {
        retainReceipt = true;
      } else {
        await updateStore((store) => {
          store.receipts = store.receipts.filter((entry) => entry.id !== receipt.id);
        });
      }
      throw new Error(result.reason || "The private payment could not be confirmed.");
    }

    await updateStore((store) => {
      store.receipts = store.receipts.map((entry) => entry.id === receipt.id
        ? { ...entry, state: "retryable" }
        : entry);
      store.notes = store.notes.map((note) => note.commitment === result.freshNote?.commitment
        ? { ...note, state: "available" }
        : note);
    });
    return { ...receipt, state: "retryable" };
  } catch (error) {
    if (!retainReceipt) {
      const store = await currentStore();
      if (store.receipts.some((entry) => entry.id === receipt.id && entry.state === "settling")) {
        await updateStore((current) => {
          current.receipts = current.receipts.filter((entry) => entry.id !== receipt.id);
        });
      }
    }
    throw error;
  }
}

export async function markGloamQueryReceiptConsumed(receiptId: string): Promise<void> {
  await updateStore((store) => {
    store.receipts = store.receipts.map((receipt) => receipt.id === receiptId
      ? { ...receipt, state: "consumed" }
      : receipt);
  });
}

export async function claimGloamQueryReceipt(receiptId: string, vaultId: string): Promise<GloamQueryReceipt | null> {
  return updateStore((store) => {
    const receipt = store.receipts.find((entry) => entry.id === receiptId);
    if (!receipt || receipt.vaultId !== vaultId || receipt.state !== "retryable") return null;
    receipt.state = "processing";
    return receipt;
  });
}

export async function releaseGloamQueryReceipt(receiptId: string): Promise<void> {
  await updateStore((store) => {
    store.receipts = store.receipts.map((receipt) => receipt.id === receiptId
      ? { ...receipt, state: "retryable" }
      : receipt);
  });
}