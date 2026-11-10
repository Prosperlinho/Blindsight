import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prepareDataset } from "@/lib/datasetQuality";
import { isValidNearAccountId } from "@/lib/nearAccount";
import { nearToYocto } from "@/lib/paymentConfig";
import type { MarketplaceVault } from "@/lib/demoVaults";

const PINATA_API_URL = "https://api.pinata.cloud";
const METADATA_PIN_NAME = "blindsight-vault-metadata";
const PIN_PAGE_SIZE = 100;
const MAX_LISTED_VAULTS = 100;
const MAX_DATASET_BYTES = 500_000;
const PINATA_TIMEOUT_MS = 8_000;
const GATEWAY_TIMEOUT_MS = 6_000;
const MAX_FETCH_ATTEMPTS = 3;

export type PublishedVaultRecord = {
  id: string;
  title: string;
  description: string;
  priceNear: string;
  publisherAddress: string;
  payoutAddress: string;
  fileRef: string;
  createdAt: number;
  rowCount: number;
};

type StoredVaultMetadata = Omit<PublishedVaultRecord, "id">;

type PinataPin = {
  ipfs_pin_hash: string;
  metadata?: { name?: string; keyvalues?: Record<string, string> };
};

type PinataPinList = { rows?: PinataPin[]; count?: number };

type EncryptedDataset = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export class PublishedVaultStorageError extends Error {
  readonly code: string;
  readonly stage: string;
  readonly status?: number;

  constructor(code: string, stage: string, status?: number) {
    super(`${stage}: ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "PublishedVaultStorageError";
    this.code = code;
    this.stage = stage;
    this.status = status;
  }
}

function getPinataConfig() {
  const apiKey = process.env.PINATA_API_KEY?.trim() ?? "";
  const secretApiKey = process.env.PINATA_SECRET_API_KEY?.trim() ?? "";
  const encryptionKey = (process.env.PUBLISHED_VAULT_ENCRYPTION_KEY?.trim() ?? "").replace(/^0x/i, "");

  if (!apiKey) throw new PublishedVaultStorageError("MISSING_PINATA_API_KEY", "configuration");
  if (!secretApiKey) throw new PublishedVaultStorageError("MISSING_PINATA_SECRET_API_KEY", "configuration");
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new PublishedVaultStorageError("INVALID_PUBLISHED_VAULT_ENCRYPTION_KEY", "configuration");
  }
  return {
    apiKey,
    secretApiKey,
    encryptionKey: Buffer.from(encryptionKey, "hex"),
  };
}

async function pinataFetch(url: string, init: RequestInit, stage: string): Promise<Response> {
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PINATA_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.status < 500 && response.status !== 429) return response;
      if (attempt === MAX_FETCH_ATTEMPTS - 1) return response;
      await response.body?.cancel();
    } catch (error) {
      if (attempt === MAX_FETCH_ATTEMPTS - 1) {
        const code = error instanceof Error && error.name === "AbortError" ? "PINATA_TIMEOUT" : "PINATA_NETWORK_ERROR";
        console.error("[Published Vaults] Pinata request failed:", { stage, code });
        throw new PublishedVaultStorageError(code, stage);
      }
    } finally {
      clearTimeout(timeoutId);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new PublishedVaultStorageError("PINATA_REQUEST_FAILED", stage);
}

function pinataHeaders(apiKey: string, secretApiKey: string) {
  return {
    pinata_api_key: apiKey,
    pinata_secret_api_key: secretApiKey,
  };
}

async function pinataJson<T>(response: Response, stage: string): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    const code = response.status === 401 || response.status === 403 ? "PINATA_AUTH_FAILED" : "PINATA_INVALID_RESPONSE";
    console.error("[Published Vaults] Pinata request failed:", { stage, code, status: response.status });
    throw new PublishedVaultStorageError(code, stage, response.status);
  }
  if (!response.ok || typeof value !== "object" || value === null || "error" in value) {
    const code = response.status === 401 || response.status === 403
      ? "PINATA_AUTH_FAILED"
      : response.status === 429
        ? "PINATA_RATE_LIMITED"
        : "PINATA_REQUEST_FAILED";
    console.error("[Published Vaults] Pinata request failed:", { stage, code, status: response.status });
    throw new PublishedVaultStorageError(code, stage, response.status);
  }
  return value as T;
}

function isCid(value: string): boolean {
  return /^[A-Za-z0-9]{32,120}$/.test(value);
}

function isStoredVaultMetadata(value: unknown): value is StoredVaultMetadata {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<StoredVaultMetadata>;
  if (typeof record.title !== "string"
    || typeof record.description !== "string"
    || typeof record.priceNear !== "string"
    || typeof record.publisherAddress !== "string"
    || typeof record.payoutAddress !== "string"
    || typeof record.fileRef !== "string"
    || typeof record.createdAt !== "number"
    || typeof record.rowCount !== "number"
    || !isCid(record.fileRef)
    || !isValidNearAccountId(record.publisherAddress)
    || !isValidNearAccountId(record.payoutAddress)) return false;

  try {
    nearToYocto(record.priceNear);
    return true;
  } catch {
    return false;
  }
}

function getGatewayUrl(cid: string) {
  const configured = process.env.PINATA_GATEWAY_URL?.trim().replace(/\/+$/, "");
  const gateway = configured || "https://gateway.pinata.cloud";
  return `${gateway.endsWith("/ipfs") ? gateway : `${gateway}/ipfs`}/${encodeURIComponent(cid)}`;
}

async function fetchIpfsJson<T>(cid: string): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
    try {
      const response = await fetch(getGatewayUrl(cid), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 404) {
        if (attempt === MAX_FETCH_ATTEMPTS - 1) {
          console.error("[Published Vaults] IPFS gateway content was not found.", {
            stage: "ipfs-gateway",
            code: "IPFS_CONTENT_NOT_FOUND",
          });
          return null;
        }
      } else if (!response.ok) {
        if ((response.status < 500 && response.status !== 429) || attempt === MAX_FETCH_ATTEMPTS - 1) {
          console.error("[Published Vaults] IPFS gateway request failed:", { stage: "ipfs-gateway", status: response.status });
          throw new PublishedVaultStorageError("IPFS_GATEWAY_REQUEST_FAILED", "ipfs-gateway", response.status);
        }
      } else {
        try {
          return await response.json() as T;
        } catch {
          console.error("[Published Vaults] IPFS gateway returned invalid JSON.", { stage: "ipfs-gateway" });
          throw new PublishedVaultStorageError("IPFS_GATEWAY_INVALID_JSON", "ipfs-gateway");
        }
      }
    } catch (error) {
      if (error instanceof PublishedVaultStorageError) throw error;
      if (attempt === MAX_FETCH_ATTEMPTS - 1) {
        const code = error instanceof Error && error.name === "AbortError" ? "IPFS_GATEWAY_TIMEOUT" : "IPFS_GATEWAY_NETWORK_ERROR";
        console.error("[Published Vaults] IPFS gateway request failed:", { stage: "ipfs-gateway", code });
        throw new PublishedVaultStorageError(code, "ipfs-gateway");
      }
    } finally {
      clearTimeout(timeoutId);
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw new PublishedVaultStorageError("IPFS_GATEWAY_UNAVAILABLE", "ipfs-gateway");
}

function encryptDataset(dataset: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(dataset, "utf8"), cipher.final()]);
  const value: EncryptedDataset = {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return JSON.stringify(value);
}

function decryptDataset(value: unknown, key: Buffer): string | null {
  if (typeof value !== "object" || value === null) return null;
  const encrypted = value as Partial<EncryptedDataset>;
  if (encrypted.version !== 1
    || typeof encrypted.iv !== "string"
    || typeof encrypted.tag !== "string"
    || typeof encrypted.ciphertext !== "string") return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

async function listPinataMetadataPins(): Promise<PinataPin[]> {
  const { apiKey, secretApiKey } = getPinataConfig();
  const pins: PinataPin[] = [];
  let pageOffset = 0;

  while (pins.length < MAX_LISTED_VAULTS) {
    const params = new URLSearchParams({
      status: "pinned",
      pageLimit: String(PIN_PAGE_SIZE),
      pageOffset: String(pageOffset),
    });
    params.set("metadata[name]", METADATA_PIN_NAME);

    const response = await pinataFetch(`${PINATA_API_URL}/data/pinList?${params}`, {
      headers: pinataHeaders(apiKey, secretApiKey),
      cache: "no-store",
    }, "pinata-list");
    const result = await pinataJson<PinataPinList>(response, "pinata-list");
    const rows = result.rows ?? [];
    pins.push(...rows.filter((pin) => pin.metadata?.name === METADATA_PIN_NAME));
    if (rows.length < PIN_PAGE_SIZE || pageOffset + rows.length >= (result.count ?? 0)) break;
    pageOffset += rows.length;
  }

  return pins.slice(0, MAX_LISTED_VAULTS);
}

async function fetchStoredMetadata(cid: string): Promise<PublishedVaultRecord | null> {
  if (!isCid(cid)) return null;
  const value = await fetchIpfsJson<unknown>(cid);
  if (!isStoredVaultMetadata(value)) return null;
  return { ...value, id: cid };
}

export function toPublishedVaultListing(record: PublishedVaultRecord): MarketplaceVault {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    category: "Custom",
    seller: record.payoutAddress,
    publisherAddress: record.publisherAddress,
    priceNear: record.priceNear,
    rows: record.rowCount,
    updated: "Published",
    createdAt: record.createdAt,
    source: "published",
  };
}

export async function listPublishedVaults(): Promise<MarketplaceVault[]> {
  const pins = await listPinataMetadataPins();
  const records = await Promise.all(pins.map(async (pin) => {
    try {
      return await fetchStoredMetadata(pin.ipfs_pin_hash);
    } catch {
      return null;
    }
  }));
  return records
    .filter((record): record is PublishedVaultRecord => record !== null)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map(toPublishedVaultListing);
}

export async function getPublishedVault(id: string): Promise<PublishedVaultRecord | null> {
  if (!isCid(id)) return null;
  const { apiKey, secretApiKey } = getPinataConfig();
  const params = new URLSearchParams({
    status: "pinned",
    hashContains: id,
    pageLimit: "1",
    pageOffset: "0",
  });
  const response = await pinataFetch(`${PINATA_API_URL}/data/pinList?${params}`, {
    headers: pinataHeaders(apiKey, secretApiKey),
    cache: "no-store",
  }, "pinata-list");
  const result = await pinataJson<PinataPinList>(response, "pinata-list");
  const pin = result.rows?.find((row) => row.ipfs_pin_hash === id && row.metadata?.name === METADATA_PIN_NAME);
  return pin ? fetchStoredMetadata(id) : null;
}

export async function getPublishedVaultDataset(record: PublishedVaultRecord): Promise<string | null> {
  const { encryptionKey } = getPinataConfig();
  const encrypted = await fetchIpfsJson<unknown>(record.fileRef);
  if (!encrypted) {
    console.error("[Published Vaults] Encrypted dataset was not available from the IPFS gateway.", {
      stage: "dataset-download",
      code: "DATASET_NOT_FOUND",
    });
    return null;
  }
  const dataset = decryptDataset(encrypted, encryptionKey);
  if (!dataset) {
    console.error("[Published Vaults] Encrypted dataset could not be decrypted.", {
      stage: "dataset-decryption",
      code: "DATASET_DECRYPTION_FAILED",
    });
  }
  return dataset;
}

async function pinJson(content: unknown, name: string, keyvalues: Record<string, string>): Promise<string> {
  const { apiKey, secretApiKey } = getPinataConfig();
  const response = await pinataFetch(`${PINATA_API_URL}/pinning/pinJSONToIPFS`, {
    method: "POST",
    headers: {
      ...pinataHeaders(apiKey, secretApiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataContent: content,
      pinataMetadata: { name, keyvalues },
    }),
    cache: "no-store",
  }, "metadata-upload");
  const result = await pinataJson<{ IpfsHash?: string }>(response, "metadata-upload");
  if (!result.IpfsHash || !isCid(result.IpfsHash)) {
    console.error("[Published Vaults] Pinata returned an invalid metadata CID.", { stage: "metadata-upload" });
    throw new PublishedVaultStorageError("INVALID_METADATA_CID", "metadata-upload");
  }
  return result.IpfsHash;
}

async function pinEncryptedDataset(dataset: string, id: string): Promise<string> {
  const { apiKey, secretApiKey, encryptionKey } = getPinataConfig();
  const form = new FormData();
  const bytes = new TextEncoder().encode(encryptDataset(dataset, encryptionKey));
  form.append("file", new Blob([bytes], { type: "application/json" }), `${id}.encrypted.json`);
  form.append("pinataMetadata", JSON.stringify({
    name: `blindsight-vault-data-${id}`,
    keyvalues: { application: "blindsight", kind: "encrypted-vault-data" },
  }));

  const response = await pinataFetch(`${PINATA_API_URL}/pinning/pinFileToIPFS`, {
    method: "POST",
    headers: pinataHeaders(apiKey, secretApiKey),
    body: form,
    cache: "no-store",
  }, "dataset-upload");
  const result = await pinataJson<{ IpfsHash?: string }>(response, "dataset-upload");
  if (!result.IpfsHash || !isCid(result.IpfsHash)) {
    console.error("[Published Vaults] Pinata returned an invalid dataset CID.", { stage: "dataset-upload" });
    throw new PublishedVaultStorageError("INVALID_DATASET_CID", "dataset-upload");
  }
  return result.IpfsHash;
}

export async function createPublishedVault(input: {
  title: string;
  description: string;
  priceNear: string;
  publisherAddress: string;
  payoutAddress: string;
  dataset: string;
}): Promise<MarketplaceVault> {
  const title = input.title.trim();
  const description = input.description.trim();
  const dataset = input.dataset.trim();
  const priceNear = input.priceNear.trim();
  const publisherAddress = input.publisherAddress.trim();
  const payoutAddress = input.payoutAddress.trim();

  if (!title || title.length > 80) throw new Error("Enter a title up to 80 characters.");
  if (description.length > 220) throw new Error("Description must be 220 characters or fewer.");
  if (!isValidNearAccountId(publisherAddress) || !isValidNearAccountId(payoutAddress)) {
    throw new Error("A valid NEAR publisher and payout account are required.");
  }
  nearToYocto(priceNear);
  if (!dataset || Buffer.byteLength(dataset, "utf8") > MAX_DATASET_BYTES) {
    throw new Error("Choose a non-empty dataset smaller than 500 KB.");
  }

  const prepared = prepareDataset(dataset);
  const id = randomBytes(16).toString("hex");
  const fileRef = await pinEncryptedDataset(dataset, id);
  const metadata: StoredVaultMetadata = {
    title,
    description,
    priceNear,
    publisherAddress,
    payoutAddress,
    fileRef,
    createdAt: Date.now(),
    rowCount: prepared.rowCount,
  };
  const metadataCid = await pinJson(metadata, METADATA_PIN_NAME, {
    application: "blindsight",
    kind: "vault-metadata",
  });

  return toPublishedVaultListing({ ...metadata, id: metadataCid });
}
