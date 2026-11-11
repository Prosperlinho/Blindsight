import "server-only";

/**
 * Verifiable private inference through NEAR AI Cloud.
 *
 * 1. Attest:  fetch NEAR AI's attestation report with a fresh nonce and verify
 *             it ourselves. The gateway's Intel TDX quote must pass Intel DCAP
 *             verification and bind the gateway signing key plus our nonce; that
 *             key must sign the gateway's OHTTP key; the model's own TDX quote
 *             is verified and checked for our nonce.
 * 2. Encrypt: send the request with Oblivious HTTP (RFC 9458), encrypted to the
 *             attested OHTTP key. TLS for cloud-api.near.ai terminates outside the
 *             enclave, so this is what keeps prompts unreadable until they are
 *             inside the TEE.
 * 3. Prove:   fetch the gateway's signature over sha256(request):sha256(response)
 *             and verify it with the attested gateway key.
 *
 * Attestation is cached per server instance for ATTESTATION_TTL_MS. When any
 * step fails, inference falls back to standard HTTPS so a paid answer is still
 * delivered, and the receipt records exactly what was (not) verified.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  verify as verifySignature,
} from "node:crypto";
import { getCollateralAndVerify } from "@phala/dcap-qvl";

const NEAR_AI_ORIGIN = "https://cloud-api.near.ai";
const NEAR_AI_HOST = "cloud-api.near.ai";
const ATTESTATION_TTL_MS = 10 * 60 * 1000;
const ATTESTATION_FETCH_TIMEOUT_MS = 30_000;
const SIGNATURE_WAIT_MS = 8_000;
/** Intel TCB levels accepted as a trustworthy platform. */
const ACCEPTED_TCB_STATUS = new Set(["UpToDate", "SWHardeningNeeded"]);

// HPKE suite NEAR AI's gateway publishes: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.
const KEM_X25519_SHA256 = 0x0020;
const KDF_HKDF_SHA256 = 0x0001;
const AEAD_AES_128_GCM = 0x0001;

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

// ─── Types ───────────────────────────────────────────────────────────────────

type AttestedEnvironment = {
  model: string;
  nonce: string;
  verifiedAt: number;
  gateway: { signingKey: string; tcbStatus: string };
  ohttp: { keyId: number; publicKey: Buffer };
  modelAttestation: {
    provider: string | null;
    tcbStatus: string | null;
    nonceBound: boolean;
    gpuVerdict: string | null;
  };
};

/** What the buyer is shown about how their answer was produced. */
export type PrivacyReceipt = {
  /** The gateway TEE was verified against Intel and bound to a fresh nonce. */
  attested: boolean;
  /** The question travelled encrypted to the attested enclave (OHTTP). */
  encryptedToEnclave: boolean;
  /** The enclave signed this exact question and answer, and we verified it. */
  responseSigned: boolean;
  model: string;
  provider: string | null;
  gatewayTcbStatus: string | null;
  modelTcbStatus: string | null;
  modelNonceBound: boolean;
  gpuVerdict: string | null;
  attestedAt: string | null;
  attestationNonce: string | null;
  signer: string | null;
  requestHash: string;
  responseHash: string;
  /** Stage that prevented full verification, when something fell back. */
  note: string | null;
};

export type PrivateCompletion = {
  status: number;
  rawBody: string;
  receipt: PrivacyReceipt;
};

class AttestationError extends Error {
  constructor(readonly stage: string, message: string) {
    super(message);
    this.name = "AttestationError";
  }
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const u16 = (value: number) => Buffer.from([value >> 8, value & 0xff]);

function timeoutSignal(ms: number, parent?: AbortSignal) {
  const signals = [AbortSignal.timeout(ms)];
  if (parent) signals.push(parent);
  return AbortSignal.any(signals);
}

function ed25519Key(hexKey: string) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hexKey, "hex")]),
    format: "der",
    type: "spki",
  });
}

function verifyEd25519(hexKey: string, message: Buffer, signature: string): boolean {
  const key = ed25519Key(hexKey);
  const candidates = [
    /^(0x)?[0-9a-f]{128}$/i.test(signature) ? Buffer.from(signature.replace(/^0x/, ""), "hex") : null,
    Buffer.from(signature, "base64"),
  ];
  return candidates.some((bytes) => {
    if (!bytes || bytes.length !== 64) return false;
    try {
      return verifySignature(null, message, key, bytes);
    } catch {
      return false;
    }
  });
}

type QuoteCheck = { status: string; reportData: Buffer };

async function verifyTdxQuote(quote: Buffer, stage: string): Promise<QuoteCheck> {
  let result: Awaited<ReturnType<typeof getCollateralAndVerify>>;
  try {
    result = await getCollateralAndVerify(quote);
  } catch (error) {
    throw new AttestationError(stage, `TDX quote failed Intel verification: ${error instanceof Error ? error.message : "unknown"}`);
  }
  const report = result.report as unknown as { data?: { reportData?: Uint8Array; base?: { reportData?: Uint8Array } } };
  const reportData = report.data?.reportData ?? report.data?.base?.reportData;
  if (!reportData || reportData.length !== 64) {
    throw new AttestationError(stage, "TDX quote has no report data.");
  }
  return { status: String(result.status), reportData: Buffer.from(reportData) };
}

// ─── Attestation ─────────────────────────────────────────────────────────────

type ReportJson = {
  gateway_attestation?: {
    signing_address?: string;
    signing_algo?: string;
    request_nonce?: string;
    intel_quote?: string;
  };
  model_attestations?: Array<Record<string, unknown>>;
  ohttp_key_config?: string;
  ohttp_attestation?: { signing_algo?: string; signing_key?: string; signature?: string };
};

async function attest(apiKey: string, model: string): Promise<AttestedEnvironment> {
  const nonce = randomBytes(32).toString("hex");
  const params = new URLSearchParams({ model, signing_algo: "ed25519", nonce });
  const response = await fetch(`${NEAR_AI_ORIGIN}/v1/attestation/report?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: timeoutSignal(ATTESTATION_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new AttestationError("report-fetch", `Attestation report returned HTTP ${response.status}.`);
  const report = await response.json() as ReportJson;

  // Gateway: Intel-verified TDX quote binding [signing key || our nonce].
  const gateway = report.gateway_attestation;
  if (!gateway?.intel_quote || gateway.signing_algo !== "ed25519" || !/^[0-9a-f]{64}$/i.test(gateway.signing_address ?? "")) {
    throw new AttestationError("gateway", "Gateway attestation is missing or malformed.");
  }
  if (gateway.request_nonce !== nonce) throw new AttestationError("gateway", "Gateway attestation is not bound to our nonce.");
  const signingKey = gateway.signing_address!.toLowerCase();

  const modelEntries = Array.isArray(report.model_attestations) ? report.model_attestations : [];
  const modelEntry = modelEntries.find((entry) => entry.model === model) ?? modelEntries[0] ?? null;
  const modelQuote = typeof modelEntry?.quote_b64 === "string"
    ? Buffer.from(modelEntry.quote_b64, "base64")
    : typeof modelEntry?.intel_quote === "string" ? Buffer.from(modelEntry.intel_quote, "hex") : null;

  const [gatewayQuote, modelQuoteCheck] = await Promise.all([
    verifyTdxQuote(Buffer.from(gateway.intel_quote, "hex"), "gateway-quote"),
    modelQuote ? verifyTdxQuote(modelQuote, "model-quote").catch((error: unknown) => error as AttestationError) : Promise.resolve(null),
  ]);

  if (!ACCEPTED_TCB_STATUS.has(gatewayQuote.status)) {
    throw new AttestationError("gateway-quote", `Gateway platform TCB status is ${gatewayQuote.status}.`);
  }
  const expectedReportData = Buffer.concat([Buffer.from(signingKey, "hex"), Buffer.from(nonce, "hex")]);
  if (!gatewayQuote.reportData.equals(expectedReportData)) {
    throw new AttestationError("gateway-quote", "Gateway quote does not bind the signing key and nonce.");
  }

  // OHTTP key: must be the attested config, signed by the attested gateway key.
  const keyConfigHex = report.ohttp_key_config ?? "";
  const ohttpAttestation = report.ohttp_attestation;
  if (!/^[0-9a-f]+$/i.test(keyConfigHex) || ohttpAttestation?.signing_key?.toLowerCase() !== signingKey || !ohttpAttestation.signature) {
    throw new AttestationError("ohttp-key", "OHTTP key is not attested by the gateway.");
  }
  const keyConfig = Buffer.from(keyConfigHex, "hex");
  if (!verifyEd25519(signingKey, keyConfig, ohttpAttestation.signature)) {
    throw new AttestationError("ohttp-key", "OHTTP key signature is invalid.");
  }
  if (keyConfig.length < 41
    || keyConfig.readUInt16BE(1) !== KEM_X25519_SHA256
    || keyConfig.readUInt16BE(37) !== KDF_HKDF_SHA256
    || keyConfig.readUInt16BE(39) !== AEAD_AES_128_GCM) {
    throw new AttestationError("ohttp-key", "Unsupported OHTTP key configuration.");
  }

  // Model TEE: verify its quote and look for our nonce in its report data.
  let modelTcbStatus: string | null = null;
  let nonceBound = false;
  if (modelQuoteCheck && !(modelQuoteCheck instanceof Error)) {
    modelTcbStatus = modelQuoteCheck.status;
    const reportDataHex = modelQuoteCheck.reportData.toString("hex");
    const e2eKey = typeof modelEntry?.e2e_pubkey === "string" ? modelEntry.e2e_pubkey : "";
    const bindings = [
      nonce, // dstack-style providers: report_data[32..64] = nonce
      e2eKey ? sha256Hex(nonce + e2eKey) : "", // chutes: sha256(nonce_hex || e2e_pubkey)
    ].filter(Boolean);
    nonceBound = ACCEPTED_TCB_STATUS.has(modelQuoteCheck.status)
      && bindings.some((binding) => reportDataHex.slice(0, 64) === binding || reportDataHex.slice(64) === binding);
  } else if (modelQuoteCheck instanceof Error) {
    console.warn("[Private Inference] Model quote verification failed:", { stage: modelQuoteCheck.stage });
  }

  return {
    model,
    nonce,
    verifiedAt: Date.now(),
    gateway: { signingKey, tcbStatus: gatewayQuote.status },
    ohttp: { keyId: keyConfig[0], publicKey: keyConfig.subarray(3, 35) },
    modelAttestation: {
      provider: typeof modelEntry?.provider === "string" ? modelEntry.provider : null,
      tcbStatus: modelTcbStatus,
      nonceBound,
      gpuVerdict: typeof modelEntry?.gpu_verdict === "string" ? modelEntry.gpu_verdict : null,
    },
  };
}

const attestationCache = new Map<string, { value?: AttestedEnvironment; pending?: Promise<AttestedEnvironment> }>();

/** Returns a verified environment, refreshing it when older than the TTL. */
async function getAttestedEnvironment(apiKey: string, model: string, waitMs: number): Promise<AttestedEnvironment | null> {
  const entry = attestationCache.get(model) ?? {};
  attestationCache.set(model, entry);
  if (entry.value && Date.now() - entry.value.verifiedAt < ATTESTATION_TTL_MS) return entry.value;

  if (!entry.pending) {
    const startedAt = Date.now();
    entry.pending = attest(apiKey, model)
      .then((value) => {
        entry.value = value;
        console.info("[Private Inference] Attestation verified.", {
          ms: Date.now() - startedAt,
          gatewayTcb: value.gateway.tcbStatus,
          modelProvider: value.modelAttestation.provider,
          modelTcb: value.modelAttestation.tcbStatus,
          modelNonceBound: value.modelAttestation.nonceBound,
        });
        return value;
      })
      .finally(() => {
        entry.pending = undefined;
      });
    entry.pending.catch((error: unknown) => {
      console.error("[Private Inference] Attestation failed:", {
        stage: error instanceof AttestationError ? error.stage : "unknown",
        message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
    });
  }

  if (waitMs <= 0) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs));
  return Promise.race([entry.pending.catch(() => null), timeout]);
}

// ─── HPKE (RFC 9180) + OHTTP (RFC 9458) + Binary HTTP (RFC 9292) ─────────────

const HPKE_V1 = Buffer.from("HPKE-v1");

function hkdfExtract(salt: Buffer, ikm: Buffer) {
  return createHmac("sha256", salt.length ? salt : Buffer.alloc(32)).update(ikm).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number) {
  const blocks: Buffer[] = [];
  let previous = Buffer.alloc(0);
  for (let counter = 1; blocks.length * 32 < length; counter += 1) {
    previous = createHmac("sha256", prk).update(Buffer.concat([previous, info, Buffer.from([counter])])).digest();
    blocks.push(previous);
  }
  return Buffer.concat(blocks).subarray(0, length);
}

const labeledExtract = (suite: Buffer, salt: Buffer, label: string, ikm: Buffer) =>
  hkdfExtract(salt, Buffer.concat([HPKE_V1, suite, Buffer.from(label), ikm]));
const labeledExpand = (suite: Buffer, prk: Buffer, label: string, info: Buffer, length: number) =>
  hkdfExpand(prk, Buffer.concat([u16(length), HPKE_V1, suite, Buffer.from(label), info]), length);

function quicVarint(value: number) {
  if (value < 64) return Buffer.from([value]);
  if (value < 16_384) return Buffer.from([0x40 | (value >> 8), value & 0xff]);
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE((value | 0x80000000) >>> 0);
  return bytes;
}

function readQuicVarint(buffer: Buffer, offset: number): [number, number] {
  const length = 1 << (buffer[offset] >> 6);
  let value = buffer[offset] & 0x3f;
  for (let index = 1; index < length; index += 1) value = value * 256 + buffer[offset + index];
  return [value, offset + length];
}

const lengthPrefixed = (value: Buffer | string) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([quicVarint(bytes.length), bytes]);
};

function encodeBinaryHttpRequest(path: string, headers: [string, string][], body: Buffer) {
  const fields = Buffer.concat(headers.flatMap(([name, value]) => [lengthPrefixed(name), lengthPrefixed(value)]));
  return Buffer.concat([
    Buffer.from([0x00]), // known-length request
    lengthPrefixed("POST"),
    lengthPrefixed("https"),
    lengthPrefixed(NEAR_AI_HOST),
    lengthPrefixed(path),
    quicVarint(fields.length),
    fields,
    quicVarint(body.length),
    body,
    quicVarint(0), // no trailers
  ]);
}

function decodeBinaryHttpResponse(buffer: Buffer): { status: number; body: Buffer } {
  let offset = 0;
  if (buffer[offset++] !== 0x01) throw new Error("Unsupported Binary HTTP response framing.");
  let status: number;
  [status, offset] = readQuicVarint(buffer, offset);
  while (status >= 100 && status < 200) {
    let skip: number;
    [skip, offset] = readQuicVarint(buffer, offset);
    offset += skip;
    [status, offset] = readQuicVarint(buffer, offset);
  }
  const [fieldsLength, fieldsStart] = readQuicVarint(buffer, offset);
  const [bodyLength, bodyStart] = readQuicVarint(buffer, fieldsStart + fieldsLength);
  return { status, body: buffer.subarray(bodyStart, bodyStart + bodyLength) };
}

async function sendOhttp(
  environment: AttestedEnvironment,
  apiKey: string,
  body: Buffer,
  signal: AbortSignal,
): Promise<{ status: number; body: Buffer }> {
  const header = Buffer.concat([
    Buffer.from([environment.ohttp.keyId]),
    u16(KEM_X25519_SHA256),
    u16(KDF_HKDF_SHA256),
    u16(AEAD_AES_128_GCM),
  ]);
  const info = Buffer.concat([Buffer.from("message/bhttp request"), Buffer.from([0x00]), header]);

  // DHKEM(X25519): ephemeral key, shared secret with the attested public key.
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const enc = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const recipient = createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, environment.ohttp.publicKey]),
    format: "der",
    type: "spki",
  });
  const dh = diffieHellman({ privateKey, publicKey: recipient });
  const kemSuite = Buffer.concat([Buffer.from("KEM"), u16(KEM_X25519_SHA256)]);
  const eaePrk = labeledExtract(kemSuite, Buffer.alloc(0), "eae_prk", dh);
  const sharedSecret = labeledExpand(kemSuite, eaePrk, "shared_secret", Buffer.concat([enc, environment.ohttp.publicKey]), 32);

  // HPKE base-mode key schedule.
  const suite = Buffer.concat([Buffer.from("HPKE"), u16(KEM_X25519_SHA256), u16(KDF_HKDF_SHA256), u16(AEAD_AES_128_GCM)]);
  const context = Buffer.concat([
    Buffer.from([0x00]),
    labeledExtract(suite, Buffer.alloc(0), "psk_id_hash", Buffer.alloc(0)),
    labeledExtract(suite, Buffer.alloc(0), "info_hash", info),
  ]);
  const secret = labeledExtract(suite, sharedSecret, "secret", Buffer.alloc(0));
  const key = labeledExpand(suite, secret, "key", context, 16);
  const baseNonce = labeledExpand(suite, secret, "base_nonce", context, 12);
  const exporterSecret = labeledExpand(suite, secret, "exp", context, 32);

  const inner = encodeBinaryHttpRequest("/v1/chat/completions", [
    ["authorization", `Bearer ${apiKey}`],
    ["content-type", "application/json"],
    ["x-no-aliasing", "true"],
    ["accept-encoding", "identity"],
  ], body);
  const cipher = createCipheriv("aes-128-gcm", key, baseNonce);
  const sealed = Buffer.concat([cipher.update(inner), cipher.final(), cipher.getAuthTag()]);

  const response = await fetch(`${NEAR_AI_ORIGIN}/ohttp`, {
    method: "POST",
    headers: { "content-type": "message/ohttp-req" },
    body: Buffer.concat([header, enc, sealed]),
    cache: "no-store",
    signal,
  });
  const outer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || response.headers.get("content-type") !== "message/ohttp-res") {
    throw new Error(`OHTTP gateway returned HTTP ${response.status}.`);
  }

  // Response: nonce (max(Nk, Nn) = 16 bytes) || AEAD ciphertext.
  const responseNonce = outer.subarray(0, 16);
  const exported = labeledExpand(suite, exporterSecret, "sec", Buffer.from("message/bhttp response"), 16);
  const prk = hkdfExtract(Buffer.concat([enc, responseNonce]), exported);
  const decipher = createDecipheriv("aes-128-gcm", hkdfExpand(prk, Buffer.from("key"), 16), hkdfExpand(prk, Buffer.from("nonce"), 12));
  const ciphertext = outer.subarray(16);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  return decodeBinaryHttpResponse(plaintext);
}

// ─── Response signature ──────────────────────────────────────────────────────

async function verifyResponseSignature(
  apiKey: string,
  model: string,
  chatId: string,
  environment: AttestedEnvironment,
  requestHash: string,
  responseHash: string,
  deadlineAt: number,
): Promise<{ verified: boolean; signer: string | null }> {
  const deadline = Math.min(Date.now() + SIGNATURE_WAIT_MS, deadlineAt);
  const params = new URLSearchParams({ model, signing_algo: "ed25519" });
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${NEAR_AI_ORIGIN}/v1/signature/${encodeURIComponent(chatId)}?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        cache: "no-store",
        signal: timeoutSignal(Math.max(500, deadline - Date.now())),
      });
      if (response.ok) {
        const payload = await response.json() as {
          text?: string; signature?: string; signing_address?: string; signature_kind?: string; error_code?: string;
        };
        if (!payload.error_code && payload.text && payload.signature) {
          const signer = (payload.signing_address ?? "").toLowerCase();
          const expectedText = payload.signature_kind === "provider_tee"
            ? `${model}:${requestHash}:${responseHash}`
            : `${requestHash}:${responseHash}`;
          const verified = payload.signature_kind === "gateway"
            && signer === environment.gateway.signingKey
            && payload.text === expectedText
            && verifyEd25519(signer, Buffer.from(payload.text, "utf8"), payload.signature);
          if (!verified) {
            console.warn("[Private Inference] Response signature did not verify.", {
              kind: payload.signature_kind,
              signerMatches: signer === environment.gateway.signingKey,
              textMatches: payload.text === expectedText,
            });
          }
          return { verified, signer: signer || null };
        }
      } else if (response.status !== 404) {
        return { verified: false, signer: null };
      }
    } catch {
      // Retry until the deadline; the signature can lag the completion briefly.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { verified: false, signer: null };
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Runs one chat completion. Waits up to `attestationWaitMs` for a verified
 * environment (cached after the first check), then sends the request over
 * attested OHTTP, falling back to standard HTTPS if that is not possible.
 */
export async function runPrivateCompletion({
  apiKey,
  model,
  requestBody,
  signal,
  attestationWaitMs,
  deadlineAt = Number.POSITIVE_INFINITY,
}: {
  apiKey: string;
  model: string;
  requestBody: string;
  signal: AbortSignal;
  attestationWaitMs: number;
  /** Epoch ms by which signature verification must give up. */
  deadlineAt?: number;
}): Promise<PrivateCompletion> {
  const body = Buffer.from(requestBody, "utf8");
  const environment = await getAttestedEnvironment(apiKey, model, attestationWaitMs);
  let note: string | null = environment ? null : "attestation-unavailable";

  let status = 0;
  let raw: Buffer | null = null;
  let encryptedToEnclave = false;

  if (environment) {
    try {
      const result = await sendOhttp(environment, apiKey, body, signal);
      status = result.status;
      raw = result.body;
      encryptedToEnclave = true;
    } catch (error) {
      if (signal.aborted) throw error;
      note = "encrypted-transport-failed";
      console.warn("[Private Inference] OHTTP request failed; using standard HTTPS.", {
        message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
    }
  }

  if (!raw) {
    const response = await fetch(`${NEAR_AI_ORIGIN}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept-Encoding": "identity",
        "x-no-aliasing": "true",
      },
      body,
      cache: "no-store",
      signal,
    });
    status = response.status;
    raw = Buffer.from(await response.arrayBuffer());
  }

  const rawBody = raw.toString("utf8");
  const requestHash = sha256Hex(body);
  const responseHash = sha256Hex(raw);
  let responseSigned = false;
  let signer: string | null = null;

  if (environment && status >= 200 && status < 300) {
    let chatId = "";
    try {
      chatId = String((JSON.parse(rawBody) as { id?: unknown }).id ?? "");
    } catch {
      chatId = "";
    }
    if (chatId) {
      ({ verified: responseSigned, signer } = await verifyResponseSignature(
        apiKey, model, chatId, environment, requestHash, responseHash, deadlineAt,
      ));
      if (!responseSigned && !note) note = "signature-unverified";
    }
  }

  return {
    status,
    rawBody,
    receipt: {
      attested: Boolean(environment),
      encryptedToEnclave,
      responseSigned,
      model,
      provider: environment?.modelAttestation.provider ?? null,
      gatewayTcbStatus: environment?.gateway.tcbStatus ?? null,
      modelTcbStatus: environment?.modelAttestation.tcbStatus ?? null,
      modelNonceBound: environment?.modelAttestation.nonceBound ?? false,
      gpuVerdict: environment?.modelAttestation.gpuVerdict ?? null,
      attestedAt: environment ? new Date(environment.verifiedAt).toISOString() : null,
      attestationNonce: environment?.nonce ?? null,
      signer,
      requestHash,
      responseHash,
      note,
    },
  };
}

/** Starts (or reuses) attestation without waiting, e.g. to warm a new instance. */
export function prewarmAttestation(apiKey: string, model: string) {
  void getAttestedEnvironment(apiKey, model, 0);
}
