import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getCollateralAndVerify } from "@phala/dcap-qvl";
import {
  ENCLAVE_SIGNATURE_HEADER,
  enclaveReportData,
  verifyExchange,
  type EnclaveAttestation,
} from "@/lib/enclaveProtocol";

/**
 * Talks to the BlindSight enclave on Phala Cloud.
 *
 * Enclave mode is on when ENCLAVE_URL is set. Before trusting the enclave the
 * server checks, with a fresh nonce:
 * 1. the TDX quote verifies against Intel's certificate chain, with an
 *    accepted TCB status and debug mode off;
 * 2. the quote's report_data binds the enclave's sealing and signing keys to
 *    that nonce;
 * 3. replaying the RTMR3 event log (recomputing every event digest) gives the
 *    quote's RTMR3, so the log is genuine;
 * 4. the log's compose-hash equals ENCLAVE_COMPOSE_HASH, i.e. the enclave runs
 *    exactly the published BlindSight code (and app-id equals ENCLAVE_APP_ID
 *    when that is set).
 * Every enclave response must carry a valid signature from the attested key.
 *
 * Not checked here: MRTD and RTMR0-2 against Phala's published OS image
 * measurements. Phala's key service only releases app keys to approved OS
 * images; anyone can re-check everything via GET /api/enclave.
 */

const ATTESTATION_TTL_MS = 10 * 60 * 1000;
const ATTESTATION_TIMEOUT_MS = 30_000;
const ACCEPTED_TCB_STATUS = new Set(["UpToDate", "SWHardeningNeeded"]);
const RUNTIME_EVENT_IMR = 3;

export class EnclaveError extends Error {
  constructor(readonly stage: string, message: string) {
    super(message);
    this.name = "EnclaveError";
  }
}

type EnclaveConfig = {
  url: string;
  token: string;
  composeHash: string;
  appId: string | null;
};

function enclaveConfig(): EnclaveConfig | null {
  const url = process.env.ENCLAVE_URL?.trim().replace(/\/+$/, "") ?? "";
  if (!url) return null;
  const token = process.env.ENCLAVE_API_TOKEN?.trim() ?? "";
  const composeHash = process.env.ENCLAVE_COMPOSE_HASH?.trim().toLowerCase().replace(/^0x/, "") ?? "";
  if (!token || !/^[0-9a-f]{64}$/.test(composeHash)) {
    throw new EnclaveError("configuration", "ENCLAVE_URL is set but ENCLAVE_API_TOKEN or ENCLAVE_COMPOSE_HASH is missing or invalid.");
  }
  const appId = process.env.ENCLAVE_APP_ID?.trim().toLowerCase().replace(/^0x/, "") || null;
  return { url, token, composeHash, appId };
}

/** True when datasets are decrypted only inside the BlindSight enclave. */
export function isEnclaveMode() {
  return Boolean(process.env.ENCLAVE_URL?.trim());
}

export type VerifiedEnclave = {
  sealPublicKey: Buffer;
  signPublicKey: Buffer;
  composeHash: string;
  appId: string | null;
  tcbStatus: string;
  verifiedAt: number;
  /** Raw evidence, published at /api/enclave for independent checks. */
  attestation: EnclaveAttestation;
};

type RuntimeEvent = { imr?: number; event_type?: number; digest?: string; event?: string; event_payload?: string };

/** dstack runtime event digest: SHA-384(u32le(type) || ":" || name || ":" || payload). */
function runtimeEventDigest(event: RuntimeEvent) {
  const type = Buffer.alloc(4);
  type.writeUInt32LE((event.event_type ?? 0) >>> 0);
  return createHash("sha384")
    .update(type)
    .update(":")
    .update(event.event ?? "", "utf8")
    .update(":")
    .update(Buffer.from(event.event_payload ?? "", "hex"))
    .digest();
}

/** Checks every RTMR3 event digest, replays them, and returns the events by name. */
export function replayRuntimeLog(eventLogJson: string, quotedRtmr3: Buffer) {
  let events: RuntimeEvent[];
  try {
    const parsed: unknown = JSON.parse(eventLogJson);
    if (!Array.isArray(parsed)) throw new Error();
    events = parsed as RuntimeEvent[];
  } catch {
    throw new EnclaveError("event-log", "Enclave event log is not valid JSON.");
  }
  let rtmr3 = Buffer.alloc(48);
  const byName = new Map<string, string>();
  for (const event of events) {
    if (event.imr !== RUNTIME_EVENT_IMR) continue;
    const digest = runtimeEventDigest(event);
    if (event.digest && !Buffer.from(event.digest, "hex").equals(digest)) {
      throw new EnclaveError("event-log", `Event "${event.event}" digest does not match its payload.`);
    }
    rtmr3 = createHash("sha384").update(rtmr3).update(digest).digest();
    if (event.event) byName.set(event.event, (event.event_payload ?? "").toLowerCase());
  }
  if (!rtmr3.equals(quotedRtmr3)) {
    throw new EnclaveError("event-log", "Replayed RTMR3 does not match the quote.");
  }
  return byName;
}

type TdReport = { tdAttributes: Uint8Array; rtMr3: Uint8Array; reportData: Uint8Array };

function tdReport(report: unknown): TdReport | null {
  // TDX 1.0 reports are flat; 1.5 and 1.5ex nest the 1.0 fields under `base`.
  let data = (report as { data?: unknown })?.data as Record<string, unknown> | undefined;
  for (let depth = 0; data && depth < 3; depth += 1) {
    if (data.rtMr3 instanceof Uint8Array && data.reportData instanceof Uint8Array && data.tdAttributes instanceof Uint8Array) {
      return data as unknown as TdReport;
    }
    data = data.base as Record<string, unknown> | undefined;
  }
  return null;
}

async function verifyEnclave(config: EnclaveConfig): Promise<VerifiedEnclave> {
  const nonce = randomBytes(32);
  let attestation: EnclaveAttestation;
  try {
    const response = await fetch(`${config.url}/attestation?nonce=${nonce.toString("hex")}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(ATTESTATION_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    attestation = await response.json() as EnclaveAttestation;
  } catch (error) {
    throw new EnclaveError("attestation-fetch", `Enclave attestation unavailable: ${error instanceof Error ? error.message : "unknown"}`);
  }

  const sealPublicKey = Buffer.from(attestation.sealPublicKey ?? "", "base64");
  const signPublicKey = Buffer.from(attestation.signPublicKey ?? "", "base64");
  if (sealPublicKey.length !== 32 || signPublicKey.length !== 32) {
    throw new EnclaveError("attestation-keys", "Enclave keys are malformed.");
  }

  let verified: Awaited<ReturnType<typeof getCollateralAndVerify>>;
  try {
    verified = await getCollateralAndVerify(Buffer.from(attestation.quote ?? "", "hex"));
  } catch (error) {
    throw new EnclaveError("quote", `Enclave TDX quote failed Intel verification: ${error instanceof Error ? error.message : "unknown"}`);
  }
  const tcbStatus = String(verified.status);
  if (!ACCEPTED_TCB_STATUS.has(tcbStatus)) throw new EnclaveError("quote", `Enclave TCB status is ${tcbStatus}.`);
  const report = tdReport(verified.report);
  if (!report) throw new EnclaveError("quote", "Enclave quote is not a TDX report.");
  if ((report.tdAttributes[0] & 0x01) !== 0) throw new EnclaveError("quote", "Enclave is running in debug mode.");

  const expectedReportData = enclaveReportData(sealPublicKey, signPublicKey, nonce);
  if (!Buffer.from(report.reportData).equals(expectedReportData)) {
    throw new EnclaveError("report-data", "Enclave quote does not bind its keys to our nonce.");
  }

  const events = replayRuntimeLog(attestation.eventLog ?? "", Buffer.from(report.rtMr3));
  const composeHash = events.get("compose-hash") ?? "";
  if (composeHash !== config.composeHash) {
    throw new EnclaveError("compose-hash", "Enclave is not running the pinned BlindSight build.");
  }
  if (attestation.appCompose
    && createHash("sha256").update(attestation.appCompose).digest("hex") !== composeHash) {
    throw new EnclaveError("compose-hash", "Published app-compose does not match the measured compose hash.");
  }
  const appId = events.get("app-id") ?? null;
  if (config.appId && appId !== config.appId) {
    throw new EnclaveError("app-id", "Enclave app ID does not match ENCLAVE_APP_ID.");
  }

  return { sealPublicKey, signPublicKey, composeHash, appId, tcbStatus, verifiedAt: Date.now(), attestation };
}

let cached: { value?: VerifiedEnclave; pending?: Promise<VerifiedEnclave> } = {};

/** Verified enclave identity, re-attested every 10 minutes. */
export async function getVerifiedEnclave(): Promise<VerifiedEnclave> {
  const config = enclaveConfig();
  if (!config) throw new EnclaveError("configuration", "Enclave mode is not enabled.");
  if (cached.value && Date.now() - cached.value.verifiedAt < ATTESTATION_TTL_MS) return cached.value;
  if (!cached.pending) {
    const startedAt = Date.now();
    cached.pending = verifyEnclave(config)
      .then((value) => {
        cached.value = value;
        console.info("[Enclave] Attestation verified.", { ms: Date.now() - startedAt, tcb: value.tcbStatus, composeHash: value.composeHash });
        return value;
      })
      .catch((error: unknown) => {
        console.error("[Enclave] Attestation failed.", {
          stage: error instanceof EnclaveError ? error.stage : "unknown",
          message: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        });
        throw error;
      })
      .finally(() => {
        cached.pending = undefined;
      });
  }
  return cached.pending;
}

function forgetEnclave() {
  cached = {};
}

/**
 * POSTs to the enclave and returns its JSON, but only if the response is
 * signed by the attested enclave key over this exact request.
 */
export async function callEnclave<T>(path: "/validate" | "/answer", payload: unknown, timeoutMs: number): Promise<T> {
  const config = enclaveConfig();
  if (!config) throw new EnclaveError("configuration", "Enclave mode is not enabled.");
  const enclave = await getVerifiedEnclave();
  const requestBody = JSON.stringify(payload);
  let response: Response;
  try {
    response = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: requestBody,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new EnclaveError("request", `Enclave request failed: ${error instanceof Error ? error.name : "unknown"}`);
  }
  const responseBody = await response.text();
  if (!response.ok) throw new EnclaveError("request", `Enclave returned HTTP ${response.status}.`);
  const signature = response.headers.get(ENCLAVE_SIGNATURE_HEADER) ?? "";
  if (!verifyExchange(enclave.signPublicKey, requestBody, responseBody, signature)) {
    // The key may have rotated with a redeploy; re-attest on the next call.
    forgetEnclave();
    throw new EnclaveError("signature", "Enclave response signature is invalid.");
  }
  try {
    return JSON.parse(responseBody) as T;
  } catch {
    throw new EnclaveError("request", "Enclave returned invalid JSON.");
  }
}
