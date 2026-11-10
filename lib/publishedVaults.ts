import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { prepareDataset } from "@/lib/datasetQuality";
import { isValidNearAccountId } from "@/lib/nearAccount";
import { nearToYocto } from "@/lib/paymentConfig";
import type { MarketplaceVault } from "@/lib/demoVaults";

const STORAGE_BUCKET = "vault-datasets";
const MAX_LISTED_VAULTS = 100;
const MAX_DATASET_BYTES = 500_000;
const SUPABASE_TIMEOUT_MS = 8_000;
const MAX_FETCH_ATTEMPTS = 3;
const VAULT_COLUMNS = "id,title,description,price,publisher_address,payout_address,file_reference,created_at";

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

type SupabaseVaultRow = {
  id: string;
  title: string;
  description: string;
  price: string | number;
  publisher_address: string;
  payout_address: string;
  file_reference: string;
  created_at: string;
};

type EncryptedDataset = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

type SupabaseConfig = {
  url: string;
  anonKey: string;
  encryptionKey: Buffer;
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

function getSupabaseConfig(): SupabaseConfig {
  const rawUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? "";
  const encryptionKey = (process.env.PUBLISHED_VAULT_ENCRYPTION_KEY?.trim() ?? "").replace(/^0x/i, "");

  if (!rawUrl) throw new PublishedVaultStorageError("MISSING_SUPABASE_URL", "configuration");
  if (!anonKey) throw new PublishedVaultStorageError("MISSING_SUPABASE_ANON_KEY", "configuration");
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
    throw new PublishedVaultStorageError("INVALID_PUBLISHED_VAULT_ENCRYPTION_KEY", "configuration");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublishedVaultStorageError("INVALID_SUPABASE_URL", "configuration");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PublishedVaultStorageError("INVALID_SUPABASE_URL", "configuration");
  }

  return {
    url: rawUrl.replace(/\/+$/, ""),
    anonKey,
    encryptionKey: Buffer.from(encryptionKey, "hex"),
  };
}

function supabaseHeaders(config: SupabaseConfig, extra: Record<string, string> = {}) {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    ...extra,
  };
}

function getStatusCode(status: number) {
  if (status === 401 || status === 403) return "SUPABASE_AUTH_FAILED";
  if (status === 404) return "SUPABASE_RESOURCE_NOT_FOUND";
  if (status === 429) return "SUPABASE_RATE_LIMITED";
  return "SUPABASE_REQUEST_FAILED";
}

async function supabaseFetch(url: string, init: RequestInit, stage: string): Promise<Response> {
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
      if ((response.status < 500 && response.status !== 429) || attempt === MAX_FETCH_ATTEMPTS - 1) {
        return response;
      }
      await response.body?.cancel();
    } catch (error) {
      if (attempt === MAX_FETCH_ATTEMPTS - 1) {
        const code = error instanceof Error && error.name === "AbortError"
          ? "SUPABASE_TIMEOUT"
          : "SUPABASE_NETWORK_ERROR";
        console.error("[Published Vaults] Supabase request failed:", { stage, code });
        throw new PublishedVaultStorageError(code, stage);
      }
    } finally {
      clearTimeout(timeoutId);
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  throw new PublishedVaultStorageError("SUPABASE_REQUEST_FAILED", stage);
}

async function supabaseJson<T>(response: Response, stage: string): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    const code = response.ok ? "SUPABASE_INVALID_RESPONSE" : getStatusCode(response.status);
    console.error("[Published Vaults] Supabase request failed:", { stage, code, status: response.status });
    throw new PublishedVaultStorageError(code, stage, response.status);
  }

  if (!response.ok) {
    const code = getStatusCode(response.status);
    console.error("[Published Vaults] Supabase request failed:", { stage, code, status: response.status });
    throw new PublishedVaultStorageError(code, stage, response.status);
  }
  return value as T;
}

function databaseUrl(config: SupabaseConfig, query: URLSearchParams) {
  return `${config.url}/rest/v1/vaults?${query.toString()}`;
}

function storageObjectUrl(config: SupabaseConfig, fileReference: string) {
  const path = fileReference.split("/").map(encodeURIComponent).join("/");
  return `${config.url}/storage/v1/object/${STORAGE_BUCKET}/${path}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mapSupabaseVault(value: unknown): PublishedVaultRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Partial<SupabaseVaultRow>;
  if (typeof row.id !== "string" || !isUuid(row.id)
    || typeof row.title !== "string"
    || typeof row.description !== "string"
    || (typeof row.price !== "string" && typeof row.price !== "number")
    || typeof row.publisher_address !== "string"
    || typeof row.payout_address !== "string"
    || typeof row.file_reference !== "string"
    || row.file_reference !== `${row.id}.json`
    || typeof row.created_at !== "string"
    || !isValidNearAccountId(row.publisher_address)
    || !isValidNearAccountId(row.payout_address)) return null;

  const priceNear = String(row.price);
  const createdAt = Date.parse(row.created_at);
  if (!Number.isFinite(createdAt)) return null;
  try {
    nearToYocto(priceNear);
  } catch {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceNear,
    publisherAddress: row.publisher_address,
    payoutAddress: row.payout_address,
    fileRef: row.file_reference,
    createdAt,
    rowCount: 0,
  };
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
  const config = getSupabaseConfig();
  const query = new URLSearchParams({
    select: VAULT_COLUMNS,
    order: "created_at.desc",
    limit: String(MAX_LISTED_VAULTS),
  });
  const response = await supabaseFetch(databaseUrl(config, query), {
    headers: supabaseHeaders(config),
  }, "vault-list");
  const rows = await supabaseJson<unknown>(response, "vault-list");
  if (!Array.isArray(rows)) {
    console.error("[Published Vaults] Supabase returned an invalid vault list.", { stage: "vault-list" });
    throw new PublishedVaultStorageError("SUPABASE_INVALID_RESPONSE", "vault-list");
  }
  return rows
    .map(mapSupabaseVault)
    .filter((record): record is PublishedVaultRecord => record !== null)
    .map(toPublishedVaultListing);
}

export async function getPublishedVault(id: string): Promise<PublishedVaultRecord | null> {
  if (!isUuid(id)) return null;
  const config = getSupabaseConfig();
  const query = new URLSearchParams({
    select: VAULT_COLUMNS,
    id: `eq.${id}`,
    limit: "1",
  });
  const response = await supabaseFetch(databaseUrl(config, query), {
    headers: supabaseHeaders(config),
  }, "vault-lookup");
  const rows = await supabaseJson<unknown>(response, "vault-lookup");
  if (!Array.isArray(rows)) {
    console.error("[Published Vaults] Supabase returned an invalid vault record.", { stage: "vault-lookup" });
    throw new PublishedVaultStorageError("SUPABASE_INVALID_RESPONSE", "vault-lookup");
  }
  return mapSupabaseVault(rows[0]);
}

export async function getPublishedVaultDataset(record: PublishedVaultRecord): Promise<string | null> {
  const config = getSupabaseConfig();
  const response = await supabaseFetch(storageObjectUrl(config, record.fileRef), {
    headers: supabaseHeaders(config),
  }, "dataset-download");
  const encrypted = await supabaseJson<unknown>(response, "dataset-download");
  const dataset = decryptDataset(encrypted, config.encryptionKey);
  if (!dataset) {
    console.error("[Published Vaults] Encrypted dataset could not be decrypted.", {
      stage: "dataset-decryption",
      code: "DATASET_DECRYPTION_FAILED",
    });
  }
  return dataset;
}

async function uploadEncryptedDataset(
  config: SupabaseConfig,
  fileReference: string,
  dataset: string,
) {
  try {
    const response = await supabaseFetch(storageObjectUrl(config, fileReference), {
      method: "POST",
      headers: supabaseHeaders(config, { "Content-Type": "application/json" }),
      body: encryptDataset(dataset, config.encryptionKey),
    }, "dataset-upload");
    await supabaseJson<unknown>(response, "dataset-upload");
  } catch (error) {
    if (!(error instanceof PublishedVaultStorageError)) throw error;
    try {
      const response = await supabaseFetch(storageObjectUrl(config, fileReference), {
        headers: supabaseHeaders(config),
      }, "dataset-upload-recovery");
      const encrypted = await supabaseJson<unknown>(response, "dataset-upload-recovery");
      if (decryptDataset(encrypted, config.encryptionKey) === dataset) return;
    } catch {
      throw error;
    }
    throw error;
  }
}

function matchesPublishedInput(
  record: PublishedVaultRecord | null,
  input: { id: string; title: string; description: string; priceNear: string; publisherAddress: string; payoutAddress: string; fileReference: string },
) {
  return record !== null
    && record.id === input.id
    && record.title === input.title
    && record.description === input.description
    && record.priceNear === input.priceNear
    && record.publisherAddress === input.publisherAddress
    && record.payoutAddress === input.payoutAddress
    && record.fileRef === input.fileReference;
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
  const config = getSupabaseConfig();
  const id = randomUUID();
  const fileReference = `${id}.json`;
  await uploadEncryptedDataset(config, fileReference, dataset);

  const query = new URLSearchParams({
    select: VAULT_COLUMNS,
  });
  const recordInput = { id, title, description, priceNear, publisherAddress, payoutAddress, fileReference };
  try {
    const metadataResponse = await supabaseFetch(databaseUrl(config, query), {
      method: "POST",
      headers: supabaseHeaders(config, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify({
        id,
        title,
        description,
        price: priceNear,
        publisher_address: publisherAddress,
        payout_address: payoutAddress,
        file_reference: fileReference,
      }),
    }, "vault-insert");
    const rows = await supabaseJson<unknown>(metadataResponse, "vault-insert");
    const record = Array.isArray(rows) ? mapSupabaseVault(rows[0]) : null;
    if (!record) throw new PublishedVaultStorageError("SUPABASE_INVALID_RESPONSE", "vault-insert");
    return toPublishedVaultListing({ ...record, rowCount: prepared.rowCount });
  } catch (error) {
    const existing = await getPublishedVault(id).catch(() => null);
    if (existing && matchesPublishedInput(existing, recordInput)) {
      return toPublishedVaultListing({ ...existing, rowCount: prepared.rowCount });
    }
    throw error;
  }
}