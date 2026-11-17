/**
 * BlindSight enclave service. Runs inside a Phala Cloud confidential VM
 * (Intel TDX, dstack).
 *
 * This is the only place a published dataset is ever decrypted. It:
 * - derives its sealing (X25519) and signing (Ed25519) keys from dstack's key
 *   service, so they exist only inside this attested app;
 * - opens sealed datasets, builds the prompt, and asks NEAR AI over attested
 *   OHTTP (lib/privateAnswer.ts, the same code as the web server's direct mode);
 * - applies the aggregate-only guard to questions and answers;
 * - signs every response so the caller can check it came from this enclave.
 *
 * It never logs questions, dataset contents or answers.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { DstackClient } from "@phala/dstack-sdk";
import { checkQuestion } from "../../lib/answerGuard";
import { prepareDataset, type PreparedDataset } from "../../lib/datasetQuality";
import {
  ENCLAVE_SIGNATURE_HEADER,
  type EnclaveAnswerRequest,
  type EnclaveAnswerResponse,
  type EnclaveAttestation,
  type EnclaveDatasetInput,
  type EnclaveValidateRequest,
  type EnclaveValidateResponse,
  ed25519PrivateKeyFromSeed,
  enclaveReportData,
  isSealedDataset,
  openSealed,
  rawPublicKey,
  signExchange,
  x25519PrivateKeyFromSeed,
} from "../../lib/enclaveProtocol";
import { answerPrivately, getInferenceStatus, InferenceFailure, MODEL } from "../../lib/privateAnswer";
import { prewarmAttestation, PrivateTransportError } from "../../lib/privateInference";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY_BYTES = 1_000_000;
const MAX_QUESTION_LENGTH = 2_000;
// The web server gives the enclave at most this long per question.
const MAX_BUDGET_MS = 50_000;
// Seal and signing keys are derived from these paths. Changing a path changes
// the key, which would make every published dataset unreadable.
const SEAL_KEY_PATH = "blindsight/vault-seal/v1";
const SIGN_KEY_PATH = "blindsight/response-sign/v1";

const apiToken = process.env.ENCLAVE_API_TOKEN?.trim() ?? "";
const nearAiKey = process.env.NEAR_AI_API_KEY?.trim() ?? "";
if (apiToken.length < 32) {
  console.error("[Enclave] ENCLAVE_API_TOKEN must be set (32+ characters). Refusing to start.");
  process.exit(1);
}
if (!nearAiKey) {
  console.error("[Enclave] NEAR_AI_API_KEY must be set. Refusing to start.");
  process.exit(1);
}

const dstack = new DstackClient();
const [sealSeed, signSeed, info] = await Promise.all([
  dstack.getKey(SEAL_KEY_PATH, "x25519-seed"),
  dstack.getKey(SIGN_KEY_PATH, "ed25519-seed"),
  dstack.info(),
]);
const sealKey = x25519PrivateKeyFromSeed(sealSeed.key);
const signKey = ed25519PrivateKeyFromSeed(signSeed.key);
const sealPublicKey = rawPublicKey(sealKey);
const signPublicKey = rawPublicKey(signKey);
const tcbInfo = info.tcb_info as { app_compose?: unknown };
const appCompose = typeof tcbInfo?.app_compose === "string" ? tcbInfo.app_compose : null;
const appId = typeof info.app_id === "string" ? info.app_id : null;
const composeHash = typeof info.compose_hash === "string" ? info.compose_hash : null;
console.info("[Enclave] Keys derived.", {
  sealPublicKey: sealPublicKey.toString("base64"),
  signPublicKey: signPublicKey.toString("base64"),
  appId,
  composeHash,
});

// Start NEAR AI attestation early so the first question is faster.
prewarmAttestation(nearAiKey, MODEL);

// ─── HTTP helpers ────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isAuthorized(req: IncomingMessage) {
  const header = req.headers.authorization ?? "";
  const presented = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(apiToken);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** Sends a JSON body signed over the exact request and response bytes. */
function sendSigned(res: ServerResponse, status: number, requestBody: string, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    [ENCLAVE_SIGNATURE_HEADER]: signExchange(signKey, requestBody, body),
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Body must be JSON.");
  }
}

function openDataset(input: EnclaveDatasetInput | undefined): PreparedDataset {
  let text: string;
  if (input?.kind === "sealed" && isSealedDataset(input.sealed)) {
    try {
      text = openSealed(input.sealed, sealKey);
    } catch {
      throw new HttpError(422, "The dataset could not be opened by this enclave.");
    }
  } else if (input?.kind === "sample" && typeof input.text === "string") {
    text = input.text;
  } else {
    throw new HttpError(400, "A sealed or sample dataset is required.");
  }
  return prepareDataset(text);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

async function handleAttestation(url: URL, res: ServerResponse) {
  const nonceHex = url.searchParams.get("nonce") ?? "";
  if (!/^[0-9a-f]{64}$/i.test(nonceHex)) throw new HttpError(400, "nonce must be 32 bytes of hex.");
  const nonce = Buffer.from(nonceHex, "hex");
  const quote = await dstack.getQuote(enclaveReportData(sealPublicKey, signPublicKey, nonce));
  const attestation: EnclaveAttestation = {
    sealPublicKey: sealPublicKey.toString("base64"),
    signPublicKey: signPublicKey.toString("base64"),
    nonce: nonceHex.toLowerCase(),
    quote: quote.quote,
    eventLog: quote.event_log,
    appId,
    composeHash,
    appCompose,
  };
  sendJson(res, 200, attestation);
}

async function handleValidate(requestBody: string, res: ServerResponse) {
  const request = parseJson(requestBody) as Partial<EnclaveValidateRequest>;
  let response: EnclaveValidateResponse;
  try {
    const prepared = openDataset(request.dataset);
    response = { ok: true, rowCount: prepared.rowCount, columnCount: prepared.columns.length };
  } catch (error) {
    if (error instanceof HttpError && error.status !== 422) throw error;
    response = { ok: false, error: error instanceof Error ? error.message : "Dataset rejected." };
  }
  sendSigned(res, 200, requestBody, response);
}

async function handleAnswer(requestBody: string, res: ServerResponse) {
  const startedAt = Date.now();
  const request = parseJson(requestBody) as Partial<EnclaveAnswerRequest>;
  const question = typeof request.question === "string" ? request.question.trim() : "";
  if (!question || question.length > MAX_QUESTION_LENGTH) throw new HttpError(400, "A question up to 2,000 characters is required.");
  const budgetMs = Math.min(MAX_BUDGET_MS, Math.max(15_000, Number(request.budgetMs) || MAX_BUDGET_MS));

  const respond = (payload: EnclaveAnswerResponse) => sendSigned(res, 200, requestBody, payload);

  const questionCheck = checkQuestion(question);
  if (!questionCheck.allowed) {
    respond({ status: "refused", code: "QUESTION_NOT_AGGREGATE", reason: questionCheck.reason });
    return;
  }

  let prepared: PreparedDataset;
  try {
    prepared = openDataset(request.dataset);
  } catch (error) {
    if (error instanceof HttpError && error.status !== 422) throw error;
    respond({ status: "dataset-rejected", error: error instanceof Error ? error.message : "Dataset rejected." });
    return;
  }

  try {
    const outcome = await answerPrivately({
      apiKey: nearAiKey,
      prepared,
      question,
      startedAt,
      inferenceDeadlineMs: budgetMs - 5_000,
      responseDeadlineMs: budgetMs - 2_000,
    });
    respond(outcome.kind === "answered"
      ? { status: "answered", insight: outcome.insight, privacy: outcome.privacy }
      : { status: "withheld", reason: outcome.reason });
  } catch (error) {
    if (error instanceof PrivateTransportError) {
      respond({ status: "transport-unavailable", stage: error.stage });
      return;
    }
    if (error instanceof InferenceFailure) {
      console.warn("[Enclave] Inference failed.", { attempts: error.attempts, aborted: error.aborted, status: getInferenceStatus(error.cause) });
      respond({ status: "inference-failed", aborted: error.aborted, upstreamStatus: getInferenceStatus(error.cause) ?? null });
      return;
    }
    throw error;
  }
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", "http://enclave");
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/attestation") {
        await handleAttestation(url, res);
        return;
      }
      if (req.method === "POST" && (url.pathname === "/validate" || url.pathname === "/answer")) {
        if (!isAuthorized(req)) throw new HttpError(401, "Unauthorized.");
        const body = await readBody(req);
        if (url.pathname === "/validate") await handleValidate(body, res);
        else await handleAnswer(body, res);
        return;
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) {
        console.error("[Enclave] Request failed.", { message: error instanceof Error ? error.message.slice(0, 200) : "unknown" });
      }
      if (!res.headersSent) sendJson(res, status, { error: error instanceof HttpError ? error.message : "Internal error." });
    }
  })();
});

server.listen(PORT, () => console.info(`[Enclave] Listening on :${PORT}`));
