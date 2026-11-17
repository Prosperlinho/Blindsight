/**
 * Wire protocol between publishers, the Next.js server and the BlindSight
 * enclave (a Phala Cloud confidential VM).
 *
 * Sealed dataset (stored in Supabase, version 2):
 *   X25519 ECDH(ephemeral, enclave) → HKDF-SHA256 → AES-256-GCM.
 *   Only the enclave holds the X25519 private key; it is derived inside the
 *   TEE from Phala's key service and bound to the attested app.
 *
 * Attestation binding: the enclave's TDX quote carries
 *   report_data = SHA-256(DOMAIN || sealKey || signKey || nonce) || 32 zero bytes
 * so a verifier knows both public keys belong to the attested code.
 *
 * Responses: the enclave signs SHA-256(request):SHA-256(response) with its
 * Ed25519 key.
 *
 * Node-only (node:crypto). The browser counterpart is lib/sealBrowser.ts.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export const SEAL_SCHEME = "x25519-hkdf-sha256-aes256gcm";
export const SEAL_HKDF_INFO = "blindsight vault seal v2";
export const SEAL_AAD = "blindsight-vault-v2";
export const REPORT_DATA_DOMAIN = "blindsight-enclave-v1";
export const ENCLAVE_SIGNATURE_HEADER = "x-enclave-signature";

export type SealedDataset = {
  version: 2;
  scheme: typeof SEAL_SCHEME;
  /** Base64 raw X25519 public key of the enclave this was sealed to. */
  enclaveKey: string;
  /** Base64 raw X25519 ephemeral public key. */
  epk: string;
  /** Base64 12-byte AES-GCM IV. */
  iv: string;
  /** Base64 ciphertext followed by the 16-byte GCM tag (WebCrypto layout). */
  ciphertext: string;
};

export function isSealedDataset(value: unknown): value is SealedDataset {
  if (typeof value !== "object" || value === null) return false;
  const sealed = value as Partial<SealedDataset>;
  return sealed.version === 2
    && sealed.scheme === SEAL_SCHEME
    && typeof sealed.enclaveKey === "string"
    && typeof sealed.epk === "string"
    && typeof sealed.iv === "string"
    && typeof sealed.ciphertext === "string";
}

// DER prefixes that turn 32 raw key bytes into KeyObjects.
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function x25519PrivateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length < 32) throw new Error("X25519 seed must be 32 bytes.");
  return createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, Buffer.from(seed.subarray(0, 32))]), format: "der", type: "pkcs8" });
}

export function ed25519PrivateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length < 32) throw new Error("Ed25519 seed must be 32 bytes.");
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed.subarray(0, 32))]), format: "der", type: "pkcs8" });
}

/** Raw 32-byte public key of an X25519 or Ed25519 key. */
export function rawPublicKey(key: KeyObject): Buffer {
  const der = createPublicKey(key).export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(der.length - 32));
}

function x25519PublicKey(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error("X25519 public key must be 32 bytes.");
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

function ed25519PublicKey(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error("Ed25519 public key must be 32 bytes.");
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

function sealKey(sharedSecret: Buffer, epk: Buffer, enclaveKey: Buffer) {
  return Buffer.from(hkdfSync("sha256", sharedSecret, Buffer.concat([epk, enclaveKey]), SEAL_HKDF_INFO, 32));
}

/** Seals `plaintext` so only the holder of `enclavePublicKey` can open it. */
export function sealForEnclave(plaintext: string, enclavePublicKey: Buffer): SealedDataset {
  const ephemeral = generateKeyPairSync("x25519");
  const epk = rawPublicKey(ephemeral.privateKey);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: x25519PublicKey(enclavePublicKey) });
  const key = sealKey(shared, epk, enclavePublicKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(SEAL_AAD));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return {
    version: 2,
    scheme: SEAL_SCHEME,
    enclaveKey: enclavePublicKey.toString("base64"),
    epk: epk.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/** Opens a sealed dataset with the enclave's X25519 private key. */
export function openSealed(sealed: SealedDataset, privateKey: KeyObject): string {
  const enclaveKey = rawPublicKey(privateKey);
  if (!enclaveKey.equals(Buffer.from(sealed.enclaveKey, "base64"))) {
    throw new Error("Dataset was sealed to a different enclave key.");
  }
  const epk = Buffer.from(sealed.epk, "base64");
  const shared = diffieHellman({ privateKey, publicKey: x25519PublicKey(epk) });
  const key = sealKey(shared, epk, enclaveKey);
  const data = Buffer.from(sealed.ciphertext, "base64");
  if (data.length < 16) throw new Error("Sealed dataset is truncated.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(SEAL_AAD));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
}

/** 64-byte TDX report_data binding both enclave keys to a verifier's nonce. */
export function enclaveReportData(sealPublicKey: Buffer, signPublicKey: Buffer, nonce: Buffer): Buffer {
  const digest = createHash("sha256")
    .update(REPORT_DATA_DOMAIN)
    .update(sealPublicKey)
    .update(signPublicKey)
    .update(nonce)
    .digest();
  return Buffer.concat([digest, Buffer.alloc(32)]);
}

function signedMessage(requestBody: string, responseBody: string) {
  const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  return Buffer.from(`${hash(requestBody)}:${hash(responseBody)}`);
}

/** Enclave side: signature over the exact request and response bodies. */
export function signExchange(privateKey: KeyObject, requestBody: string, responseBody: string): string {
  return sign(null, signedMessage(requestBody, responseBody), privateKey).toString("base64");
}

/** Verifier side: checks a response signature against the attested key. */
export function verifyExchange(signPublicKey: Buffer, requestBody: string, responseBody: string, signature: string): boolean {
  try {
    return verify(null, signedMessage(requestBody, responseBody), ed25519PublicKey(signPublicKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

// ─── Request and response bodies ─────────────────────────────────────────────

export type EnclaveAttestation = {
  sealPublicKey: string;
  signPublicKey: string;
  nonce: string;
  /** Hex TDX quote. */
  quote: string;
  /** JSON event log from dstack GetQuote. */
  eventLog: string;
  appId: string | null;
  composeHash: string | null;
  /** Raw app-compose.json, so anyone can recompute the compose hash. */
  appCompose: string | null;
};

export type EnclaveDatasetInput =
  | { kind: "sealed"; sealed: SealedDataset }
  /** Synthetic sample vaults that ship with the app. */
  | { kind: "sample"; text: string };

export type EnclaveValidateRequest = { dataset: EnclaveDatasetInput };
export type EnclaveValidateResponse =
  | { ok: true; rowCount: number; columnCount: number }
  | { ok: false; error: string };

export type EnclaveAnswerRequest = {
  dataset: EnclaveDatasetInput;
  question: string;
  /** Milliseconds the enclave may spend before it must respond. */
  budgetMs: number;
};

export type EnclaveAnswerResponse =
  | { status: "answered"; insight: string; privacy: import("./privateInference").PrivacyReceipt }
  | { status: "withheld"; reason: import("./answerGuard").GuardReason }
  | { status: "refused"; code: "QUESTION_NOT_AGGREGATE"; reason: import("./answerGuard").GuardReason }
  | { status: "dataset-rejected"; error: string }
  | { status: "transport-unavailable"; stage: "attestation-unavailable" | "encrypted-transport-failed" }
  | { status: "inference-failed"; aborted: boolean; upstreamStatus: number | null };
