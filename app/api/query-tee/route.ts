import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import {
  cachePreparedDataset,
  deleteCachedPreparedDataset,
  getCachedPreparedDataset,
  prepareDataset,
  type PreparedDataset,
} from "@/lib/datasetQuality";
import { getDemoVault } from "@/lib/demoVaults";
import { getDemoVaultDataset } from "@/lib/demoVaultDatasets";
import { getPublishedVault, getPublishedVaultDataset, getPublishedVaultSealedDataset } from "@/lib/publishedVaults";
import { prewarmAttestation, PrivateTransportError, type PrivacyReceipt } from "@/lib/privateInference";
import { answerPrivately, getInferenceStatus, InferenceFailure, MODEL } from "@/lib/privateAnswer";
import { callEnclave, EnclaveError, getVerifiedEnclave, isEnclaveMode } from "@/lib/enclaveClient";
import type { EnclaveAnswerResponse, EnclaveDatasetInput, SealedDataset } from "@/lib/enclaveProtocol";
import { getTreasuryAccount, nearToYocto } from "@/lib/paymentConfig";
import { feeToYocto, getPlatformTreasury, getQueryFeeNear, isFeeEnabled } from "@/lib/platformFees";
import {
  PaymentVerificationError,
  verifyNearTransfer,
  type VerifiedNearPayment,
} from "@/lib/paymentVerification";
import { checkQuestion, guardMessage, type GuardReason } from "@/lib/answerGuard";
import { recordActivity } from "@/lib/activityLog";
import {
  bindPaymentToQuestion,
  claimPayments,
  keyedHash,
  pushRecent,
  readRecent,
  releasePayments,
  settlePayments,
  SharedStoreError,
  unbindPayment,
} from "@/lib/sharedStore";

export const maxDuration = 60;

const MAX_QUERY_LENGTH = 2_000;
// Signature checks must finish before the 60s function limit.
const RESPONSE_DEADLINE_MS = 57_000;
// Leave headroom under maxDuration (60s) for payment verification and the response.
const INFERENCE_DEADLINE_MS = 52_000;
// The enclave needs at least this long to answer.
const MIN_ENCLAVE_BUDGET_MS = 15_000;
const QUERY_WINDOW_MS = 10 * 60 * 1000;
const MAX_QUERY_MATCHES = 5;
const MAX_REQUESTS_PER_WINDOW = 20;
const ANTI_PROBE_KEYWORDS = [
  "what is the name of",
  "show row where",
  "specifically",
  "who is the person with",
  "identify the record where",
  "which row contains",
  "show me the single value",
  "what is the value of",
];

// Anti-probing history never holds question text. Each entry keeps keyed hashes
// of the question and of its words (enough to spot repeats and overlap), plus
// a flag for extraction-style wording. Stored in Redis when configured.
type QueryPattern = { terms: string[]; timestamp: number; hash: string; receiptId: string };

type QueryHistoryEntry = {
  timestamp: number;
  hash: string;
  terms: string[];
  extraction: boolean;
  receiptId: string;
};

type QueryPayment = VerifiedNearPayment;

/**
 * Replay protection: each transaction behind an answer (vault price and
 * platform fee) is claimed together, so neither can buy a second answer.
 * In-flight claims expire so an interrupted request can't block a retry.
 */
const SETTLED_PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;
const PAYMENT_CLAIM_TTL_MS = 60 * 1000;
// A payment is tied to one question for as long as it's valid (2 hours).
const PAYMENT_BINDING_TTL_MS = 3 * 60 * 60 * 1000;

async function claimPayment(txHashes: string[]) {
  const status = await claimPayments(txHashes, PAYMENT_CLAIM_TTL_MS);
  if (status === "settled") {
    throw new PaymentVerificationError("This payment has already been used for an answer.", "PAYMENT_ALREADY_USED", 409);
  }
  if (status === "pending") {
    throw new PaymentVerificationError(
      "The answer for this payment is still being prepared. Please retry shortly.",
      "PAYMENT_IN_PROGRESS",
      409,
    );
  }
}

/** Release a claim after a failure; never throws, since the request is already failing. */
async function releasePaymentClaim(txHashes: string[]) {
  try {
    await releasePayments(txHashes);
  } catch (error) {
    console.error("[Query] Could not release payment claim:", { message: error instanceof Error ? error.message : "unknown" });
  }
}

/**
 * Caches a successfully verified transfer for a short window. Retrying a failed
 * answer reuses this result instead of paying the NEAR RPC round trip twice.
 */
type CachedVerifiedPayment = {
  payment: VerifiedNearPayment;
  feeTxHash: string | null;
  receiverId: string;
  expiresAt: number;
};

const verifiedPayments = new Map<string, CachedVerifiedPayment>();
const VERIFIED_PAYMENT_TTL_MS = 15 * 60 * 1000;

function getCachedVerifiedPayment(
  txHash: string,
  payerAccountId: string,
  minimumYocto: bigint,
  receiverId: string,
  feeTxHash: string | null,
) {
  const key = `${txHash}:${payerAccountId}`;
  const cached = verifiedPayments.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    verifiedPayments.delete(key);
    return null;
  }
  if (cached.receiverId !== receiverId || cached.feeTxHash !== feeTxHash) return null;
  try {
    if (BigInt(cached.payment.amountYocto) < minimumYocto) return null;
  } catch {
    return null;
  }
  return cached;
}

function cacheVerifiedPayment(
  payment: VerifiedNearPayment,
  receiverId: string,
  feeTxHash: string | null,
) {
  if (verifiedPayments.size > 500) {
    const now = Date.now();
    for (const [key, cached] of verifiedPayments) {
      if (cached.expiresAt <= now) verifiedPayments.delete(key);
    }
  }
  verifiedPayments.set(`${payment.txHash}:${payment.payerAccountId}`, {
    payment,
    feeTxHash,
    receiverId,
    expiresAt: Date.now() + VERIFIED_PAYMENT_TTL_MS,
  });
}

const STOP_WORDS = new Set([
  "about", "above", "after", "against", "among", "and", "are", "for", "from", "have", "into",
  "show", "that", "the", "their", "them", "then", "there", "these", "this", "those", "what",
  "when", "where", "which", "with", "would", "your", "data", "dataset", "please", "could",
]);

function queryTerms(query: string) {
  return Array.from(new Set(
    query.toLowerCase().match(/[a-z0-9]{2,}/g)?.filter((term) => !STOP_WORDS.has(term)) ?? [],
  ));
}

function queriesOverlap(left: string[], right: string[]) {
  const rightTerms = new Set(right);
  const sharedTerms = left.filter((term) => rightTerms.has(term)).length;
  return sharedTerms >= 2 && sharedTerms / Math.min(left.length, right.length) >= 0.6;
}

function isHyperSpecific(query: string, terms: string[]) {
  return terms.length >= 6 || /\b\d+(?:\.\d+)?\b|["'][^"']+["']|\b(exactly|specific|wallet|address|account|user|transaction|between|before|after|greater|less|largest|smallest)\b/i.test(query);
}

function isRepetitiveExtractionPrompt(query: string) {
  const normalized = query.toLowerCase().trim();
  return ANTI_PROBE_KEYWORDS.some((pattern) => normalized.includes(pattern)) || /\b(name of|value of|row where|person with|specific|exactly)\b/i.test(query);
}

/** Keyed hashes of the question's words, for overlap checks without the text. */
function hashedQueryTerms(query: string) {
  return queryTerms(query).map((term) => keyedHash(term).slice(0, 16));
}

function normalizeQueryHash(query: string) {
  return keyedHash(query.trim().toLowerCase().replace(/\s+/g, " "));
}

function getDatasetFingerprint(dataset: string) {
  return createHash("sha256").update(dataset).digest("hex");
}

// Anti-probing checks fail open if Redis is briefly unreachable: a buyer who
// already paid still gets an answer, and the output guard still applies.
async function isQueryPatternFlagged(request: Request, datasetFingerprint: string, query: string, receiptId: string) {
  const requester = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  const patternKey = keyedHash(`${requester}:${datasetFingerprint}`);
  try {
    const history = await readRecent<QueryPattern>("qp", patternKey, QUERY_WINDOW_MS);
    const terms = hashedQueryTerms(query);
    const hash = normalizeQueryHash(query);
    if (history.some((entry) => entry.receiptId === receiptId && entry.hash === hash)) return false;
    const overlappingCount = history.filter((entry) => queriesOverlap(entry.terms, terms)).length;
    const flagged = (isHyperSpecific(query, terms) || overlappingCount > 0) && overlappingCount >= MAX_QUERY_MATCHES;
    await pushRecent("qp", patternKey, { terms, timestamp: Date.now(), hash, receiptId }, QUERY_WINDOW_MS, 30);
    return flagged;
  } catch (error) {
    console.error("[Query] Pattern history unavailable:", { message: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

async function checkQueryHistoryLimit(datasetFingerprint: string, query: string, userId: string, receiptId: string) {
  const key = keyedHash(`${userId}:${datasetFingerprint}`);
  const allowed = { blocked: false, message: "OK" };
  try {
    const entries = await readRecent<QueryHistoryEntry>("qh", key, QUERY_WINDOW_MS);
    const signature = normalizeQueryHash(query);
    if (entries.some((entry) => entry.receiptId === receiptId && entry.hash === signature)) return allowed;
    const terms = hashedQueryTerms(query);
    const extraction = isRepetitiveExtractionPrompt(query);
    const repetitiveExtraction = extraction
      && entries.some((entry) => entry.extraction && queriesOverlap(terms, entry.terms));
    const entry: QueryHistoryEntry = { timestamp: Date.now(), hash: signature, terms, extraction, receiptId };
    await pushRecent("qh", key, entry, QUERY_WINDOW_MS, 50);

    if (entries.length >= MAX_REQUESTS_PER_WINDOW || repetitiveExtraction) {
      return {
        blocked: true,
        message: "Potential probing attack detected. Rate limit applied to protect privacy.",
      };
    }
    return allowed;
  } catch (error) {
    console.error("[Query] Query history unavailable:", { message: error instanceof Error ? error.message : "unknown" });
    return allowed;
  }
}

const TEXT_FILE_EXTENSIONS = new Set(["txt", "md", "markdown", "csv"]);

function isTextFile(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_FILE_EXTENSIONS.has(extension);
}

function formValueToText(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * Read raw text from an uploaded text file. `.txt`, `.md`, `.markdown`, and
 * `.csv` files are decoded directly from their buffer as UTF-8. Binary files
 * are rejected rather than decoded into garbage.
 */
async function readUploadedText(file: File): Promise<string> {
  const fileName = file.name || "upload.txt";
  if (!isTextFile(fileName)) {
    throw new Error("Only text files (.txt, .md, .markdown, .csv) are supported.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return buffer.toString("utf-8").trim();
}

async function parseRequestBody(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const uploadedFile = formData.get("file");
    const uploadedText = uploadedFile instanceof File
      ? await readUploadedText(uploadedFile)
      : "";
    const datasetField = formValueToText(formData.get("dataset"))
      ?? formValueToText(formData.get("text"));
    const fileContentField = formValueToText(formData.get("fileContent"));

    return {
      action: formValueToText(formData.get("action")),
      receiptId: formValueToText(formData.get("receiptId")),
      txHash: formValueToText(formData.get("txHash")),
      payerAccountId: formValueToText(formData.get("payerAccountId")),
      vaultId: formValueToText(formData.get("vaultId")),
      query: formValueToText(formData.get("query")),
      publisherAddress: formValueToText(formData.get("publisherAddress")),
      queryPrice: formValueToText(formData.get("queryPrice")),
      datasetId: formValueToText(formData.get("datasetId")),
      fileName: uploadedFile instanceof File ? uploadedFile.name : undefined,
      fileContent: fileContentField ?? uploadedText,
      dataset: datasetField ?? uploadedText,
      userId: formValueToText(formData.get("userId")),
      agentId: formValueToText(formData.get("agentId")),
    };
  }

  return req.json() as Promise<Record<string, unknown>>;
}

function errorResponse(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

function logQueryFailure(stage: string, error: unknown, secret?: string) {
  const details: Record<string, unknown> = { stage };
  if (error instanceof Error) {
    details.name = error.name;
    const message = secret ? error.message.replaceAll(secret, "[REDACTED]") : error.message;
    details.message = message.slice(0, 300);
  } else {
    details.message = "Unknown error";
  }
  if (typeof error === "object" && error !== null) {
    if ("code" in error && typeof error.code === "string") details.code = error.code;
    if ("status" in error && typeof error.status === "number") details.status = error.status;
  }
  console.error("[Query] Request failed:", details);
}

function getInferenceCredentialFailure(error: unknown) {
  const status = getInferenceStatus(error);
  if (status === 401) {
    return {
      code: "INFERENCE_INVALID_API_KEY",
      diagnostic: "NEAR AI rejected NEAR_AI_API_KEY.",
      message: "NEAR AI rejected NEAR_AI_API_KEY. Verify the key in the deployment environment, then retry with this payment.",
    };
  }
  if (status === 403) {
    return {
      code: "INFERENCE_ACCESS_DENIED",
      diagnostic: "NEAR AI denied access to the configured model.",
      message: "NEAR AI denied access to the configured model. Verify the key permissions and model access, then retry with this payment.",
    };
  }
  return null;
}

function logInferenceFailure(stage: string, error: unknown, apiKey: string) {
  const credentialFailure = getInferenceCredentialFailure(error);
  if (credentialFailure) {
    console.error(`[Query] ${credentialFailure.diagnostic}`, {
      stage,
      status: getInferenceStatus(error),
    });
    return;
  }
  logQueryFailure(stage, error, apiKey);
}

type EnclaveSummary = {
  verified: true;
  composeHash: string;
  appId: string | null;
  tcbStatus: string;
  verifiedAt: string;
  signPublicKey: string;
};

type RouteAnswer =
  | { kind: "answered"; insight: string; privacy: PrivacyReceipt; enclave: EnclaveSummary | null }
  | { kind: "withheld"; reason: GuardReason }
  | { kind: "refused"; reason: GuardReason }
  | { kind: "dataset-rejected" };

type AnswerReceipt = {
  version: 1;
  receiptHash: string;
  issuedAt: string;
  vaultId: string | null;
  rowCount: number | null;
  fieldCount: number | null;
  model: string;
  inputFingerprint: string;
  responseFingerprint: string;
  answerFingerprint: string;
  paymentTxHash: string;
  platformFeeTxHash: string | null;
};

function createAnswerReceipt({
  insight,
  receiptId,
  vaultId,
  rowCount,
  fieldCount,
  privacy,
  platformFeeTxHash,
}: {
  insight: string;
  receiptId: string;
  vaultId: string | null;
  rowCount: number | null;
  fieldCount: number | null;
  privacy: PrivacyReceipt;
  platformFeeTxHash: string | null;
}): AnswerReceipt {
  const contents = {
    version: 1 as const,
    issuedAt: new Date().toISOString(),
    vaultId,
    rowCount,
    fieldCount,
    model: privacy.model,
    inputFingerprint: privacy.requestHash,
    responseFingerprint: privacy.responseHash,
    answerFingerprint: createHash("sha256").update(insight).digest("hex"),
    paymentTxHash: receiptId,
    platformFeeTxHash,
  };
  const receiptHash = createHash("sha256").update(JSON.stringify(contents)).digest("hex");
  return { ...contents, receiptHash };
}

function validateQuestion(question: string) {
  if (!question) {
    return NextResponse.json(
      { success: false, error: "A non-empty query is required.", antiProbingCheck: "BLOCKED", noiseAdded: false },
      { status: 400 },
    );
  }
  if (question.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { success: false, error: "Query exceeds the supported MVP size.", antiProbingCheck: "BLOCKED", noiseAdded: false },
      { status: 413 },
    );
  }
  return null;
}

/**
 * Enclave mode: the enclave opens the dataset, asks NEAR AI over attested
 * OHTTP and applies the output guard. Its reply is accepted only with a valid
 * signature from the attested enclave key (checked in callEnclave).
 */
async function answerInEnclave(dataset: EnclaveDatasetInput, question: string, startedAt: number): Promise<RouteAnswer> {
  const enclave = await getVerifiedEnclave();
  const budgetMs = INFERENCE_DEADLINE_MS - (Date.now() - startedAt);
  if (budgetMs < MIN_ENCLAVE_BUDGET_MS) {
    throw new EnclaveError("budget", "Not enough time left to ask the enclave.");
  }
  const result = await callEnclave<EnclaveAnswerResponse>("/answer", { dataset, question, budgetMs }, budgetMs + 3_000);
  switch (result.status) {
    case "answered":
      return {
        kind: "answered",
        insight: result.insight,
        privacy: result.privacy,
        enclave: {
          verified: true,
          composeHash: enclave.composeHash,
          appId: enclave.appId,
          tcbStatus: enclave.tcbStatus,
          verifiedAt: new Date(enclave.verifiedAt).toISOString(),
          signPublicKey: enclave.signPublicKey.toString("base64"),
        },
      };
    case "withheld":
      return { kind: "withheld", reason: result.reason };
    case "refused":
      return { kind: "refused", reason: result.reason };
    case "dataset-rejected":
      return { kind: "dataset-rejected" };
    case "transport-unavailable":
      throw new PrivateTransportError(result.stage, "The enclave could not reach NEAR AI privately.");
    case "inference-failed":
      throw new InferenceFailure(
        Object.assign(new Error("NEAR AI inference failed inside the enclave."), result.upstreamStatus ? { status: result.upstreamStatus } : {}),
        result.aborted,
        0,
      );
    default:
      throw new EnclaveError("response", "Unexpected enclave response.");
  }
}

function storeUnavailableResponse(payment: Record<string, unknown>) {
  return errorResponse(503, "We couldn't record your payment safely right now. Your payment is confirmed; try again in a moment.", {
    code: "STORE_UNAVAILABLE",
    paymentVerified: true,
    payment,
  });
}

function successResponse({
  insight,
  receiptId,
  payment,
  privacy = null,
  enclave = null,
  answerReceipt,
}: {
  insight: string;
  receiptId: string;
  payment: Record<string, unknown>;
  privacy?: PrivacyReceipt | null;
  enclave?: EnclaveSummary | null;
  answerReceipt: AnswerReceipt;
}) {
  // Privacy guardrail: only the generated insight and payment settlement
  // metadata leave the server. Dataset text, raw file buffers, file names,
  // and any other file metadata must never be returned to the client.
  const normalized = payment as Record<string, unknown>;

  return NextResponse.json({
    success: true,
    insight,
    receiptId,
    settlementType: "VERIFIED_NEAR_TRANSFER",
    payment: {
      verified: true,
      network: normalized.network,
      txHash: normalized.txHash,
      payerAccountId: normalized.payerAccountId,
      receiverId: normalized.receiverId,
      amountNear: normalized.amountNear,
      amountYocto: normalized.amountYocto,
      blockHash: normalized.blockHash,
      blockHeight: normalized.blockHeight,
      verifiedAt: normalized.verifiedAt,
      explorerUrl: `https://testnet.nearblocks.io/txns/${normalized.txHash}`,
    },
    // How the answer was produced: TEE attestation, encrypted transport and
    // the enclave's signature over this exact question and answer.
    privacy,
    // Enclave mode: proof the dataset was opened only inside the attested
    // BlindSight enclave (null in direct mode).
    enclave,
    answerReceipt,
  });
}

export async function POST(req: NextRequest) {
  const requestStartedAt = Date.now();
  let failureStage = "request";
  // Start (or reuse) TEE attestation now so it runs alongside payment checks.
  const prewarmKey = process.env.NEAR_AI_API_KEY?.trim();
  if (isEnclaveMode()) void getVerifiedEnclave().catch(() => undefined);
  else if (prewarmKey) prewarmAttestation(prewarmKey, MODEL);
  try {
    // 1. Safely parse request body (JSON or multipart text-file upload)
    let parsedBody: unknown = {};
    try {
      parsedBody = await parseRequestBody(req);
    } catch (parseErr) {
      const isUnsupportedFile = parseErr instanceof Error
        && parseErr.message.startsWith("Only text files");
      console.error(
        "[TEE Route] Invalid request payload received:",
        parseErr instanceof Error ? parseErr.message : "unknown payload error",
      );
      return NextResponse.json(
        {
          success: false,
          error: isUnsupportedFile
            ? "Only text files (.txt, .md, .markdown, .csv) are supported."
            : "Malformed JSON payload in request body",
        },
        { status: isUnsupportedFile ? 415 : 400 },
      );
    }

    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return NextResponse.json(
        { success: false, error: "Request body must include a query and dataset metadata." },
        { status: 400 },
      );
    }

    const {
      action,
      txHash: rawTxHash,
      feeTxHash: rawFeeTxHash,
      payerAccountId,
      vaultId,
      query,
      queryPrice,
      dataset: rawDataset,
      datasetId,
      fileContent,
      userId,
      agentId,
    } = parsedBody as Record<string, unknown>;
    failureStage = "vault-storage";

    // Log only non-sensitive presence flags. Never log query text, dataset
    // text, uploaded file contents, file names, or raw buffers.
    console.log("[TEE Route] Request received:", {
      action,
      hasTxHash: typeof rawTxHash === "string" && rawTxHash.length > 0,
      hasPayer: typeof payerAccountId === "string" && payerAccountId.length > 0,
      hasVaultId: typeof vaultId === "string" && vaultId.length > 0,
      hasQuery: typeof query === "string" && query.trim().length > 0,
      hasDataset: typeof rawDataset === "string" && rawDataset.trim().length > 0,
      hasUploadedFile: typeof fileContent === "string" && fileContent.trim().length > 0,
      hasDatasetId: typeof datasetId === "string" && datasetId.length > 0,
    });

    // 2. Verify the native NEAR payment before allowing the query to run.
    const txHash = typeof rawTxHash === "string" ? rawTxHash.trim() : "";
    const payer = typeof payerAccountId === "string" ? payerAccountId.trim() : "";
    const resolvedVault = typeof vaultId === "string" ? getDemoVault(vaultId) : undefined;
    let resolvedPublishedVault: Awaited<ReturnType<typeof getPublishedVault>> = null;
    let resolvedPublishedDataset: string | null = null;
    let resolvedSealedDataset: SealedDataset | null = null;
    if (typeof vaultId === "string" && !resolvedVault) {
      try {
        resolvedPublishedVault = await getPublishedVault(vaultId);
        if (!resolvedPublishedVault) {
          console.warn("[Query] Published vault not found.", { stage: "published-vault" });
          return errorResponse(404, "This vault is no longer available.", { code: "VAULT_NOT_FOUND" });
        }
        console.info("[Query] Published vault resolved; loading dataset.", { stage: "published-dataset" });
        if (isEnclaveMode()) {
          // Fetched still sealed: only the enclave can open it.
          const sealed = await getPublishedVaultSealedDataset(resolvedPublishedVault);
          if (sealed === "legacy") {
            console.error("[Query] Published dataset predates enclave mode and needs migrating.", { stage: "published-dataset" });
            return errorResponse(503, "This vault is being moved into the enclave and is temporarily unavailable.", { code: "VAULT_NEEDS_MIGRATION" });
          }
          resolvedSealedDataset = sealed;
        } else {
          resolvedPublishedDataset = await getPublishedVaultDataset(resolvedPublishedVault);
        }
        if (!resolvedPublishedDataset && !resolvedSealedDataset) {
          console.error("[Query] Published dataset could not be loaded:", {
            stage: "published-dataset",
            code: "DATASET_UNAVAILABLE",
          });
          return errorResponse(503, "This vault is temporarily unavailable.", { code: "VAULT_DATA_UNAVAILABLE" });
        }
      } catch (error) {
        logQueryFailure("published-vault-storage", error);
        return errorResponse(503, "Published vaults are temporarily unavailable.", { code: "VAULT_STORAGE_UNAVAILABLE" });
      }
    }
    const expectedPriceNear = resolvedVault?.priceNear
      ?? resolvedPublishedVault?.priceNear
      ?? (typeof queryPrice === "string" || typeof queryPrice === "number" ? String(queryPrice) : "");

    const submittedQuery = typeof query === "string" ? query.trim() : "";
    const queryHash = submittedQuery ? normalizeQueryHash(submittedQuery) : "";
    let payment: QueryPayment;
    let receiptId = "";
    let platformFeeTxHash: string | null = null;

    failureStage = "payment-verification";
    if (!txHash) {
      return errorResponse(
        402,
        "A verified NEAR testnet payment is required before this query can run.",
        { code: "MISSING_TX_HASH", paymentVerified: false },
      );
    }
    if (!payer) {
      return errorResponse(
        402,
        "The payer NEAR account is required to verify the payment.",
        { code: "MISSING_PAYER", paymentVerified: false },
      );
    }

    if (!expectedPriceNear) {
      return errorResponse(400, "A query price is required for payment verification.", {
        code: "MISSING_PRICE",
      });
    }

    let minimumYocto: bigint;
    try {
      minimumYocto = nearToYocto(expectedPriceNear);
    } catch {
      return errorResponse(400, "The query price is not a valid NEAR amount.", {
        code: "INVALID_PRICE",
      });
    }

    const receiver = resolvedPublishedVault?.payoutAddress
      ?? resolvedVault?.seller
      ?? getTreasuryAccount();
    // Platform fee: a separate transfer from the same payer to the platform
    // treasury, on top of the vault price that goes to the publisher.
    const queryFeeNear = getQueryFeeNear();
    const feeRequired = isFeeEnabled(queryFeeNear);
    const feeTxHash = feeRequired && typeof rawFeeTxHash === "string" ? rawFeeTxHash.trim() : "";
    platformFeeTxHash = feeTxHash || null;
    if (feeRequired && !feeTxHash) {
      return errorResponse(402, "The platform fee payment is missing. Please try again.", {
        code: "MISSING_FEE_TX",
        paymentVerified: false,
      });
    }
    if (feeRequired && feeTxHash === txHash) {
      return errorResponse(400, "The platform fee must be a separate transfer.", {
        code: "INVALID_FEE_TX",
        paymentVerified: false,
      });
    }

    // Fee actually transferred, for the admin log. A cached payment keeps the configured fee.
    let paidFeeNear: string | null = feeRequired ? queryFeeNear : null;
    const cachedPayment = getCachedVerifiedPayment(txHash, payer, minimumYocto, receiver, feeTxHash || null);
    if (cachedPayment) {
      payment = cachedPayment.payment;
    } else {
      const verificationStartedAt = Date.now();
      try {
        const [verifiedPayment, verifiedFee] = await Promise.all([
          verifyNearTransfer({
            txHash,
            payerAccountId: payer,
            expectedReceiver: receiver,
            minimumYocto,
          }),
          feeRequired
            ? verifyNearTransfer({
              txHash: feeTxHash,
              payerAccountId: payer,
              expectedReceiver: getPlatformTreasury(),
              minimumYocto: feeToYocto(queryFeeNear),
            }).catch((feeError: unknown) => {
              if (feeError instanceof PaymentVerificationError) {
                throw new PaymentVerificationError(
                  `Platform fee: ${feeError.message}`,
                  `FEE_${feeError.code}`,
                  feeError.status,
                );
              }
              throw feeError;
            })
            : Promise.resolve(null),
        ]);
        payment = verifiedPayment;
        if (verifiedFee) paidFeeNear = verifiedFee.amountNear;
      } catch (verificationError) {
        if (verificationError instanceof PaymentVerificationError) {
          logQueryFailure("near-payment-verification", verificationError);
          return errorResponse(verificationError.status, verificationError.message, {
            code: verificationError.code,
            paymentVerified: false,
          });
        }
        throw verificationError;
      }
      cacheVerifiedPayment(payment, receiver, feeTxHash || null);
      console.info("[Query] Payment verified.", {
        stage: "near-payment-verification",
        ms: Date.now() - verificationStartedAt,
      });
    }

    const nearReceiptId = payment.txHash;
    if (!nearReceiptId) {
      return errorResponse(402, "The payment record is incomplete. Please retry the query.", {
        code: "INCOMPLETE_PAYMENT",
        paymentVerified: false,
      });
    }
    receiptId = nearReceiptId;

    // Aggregate-only policy: refuse requests for raw records before the payment
    // is tied to this question, so the buyer can rephrase without paying again.
    if (submittedQuery && action !== "prepare") {
      const questionCheck = checkQuestion(submittedQuery);
      if (!questionCheck.allowed) {
        console.warn("[Query] Question refused by aggregate-only guard.", { reason: questionCheck.reason });
        return errorResponse(422, guardMessage(questionCheck.reason), {
          code: "QUESTION_NOT_AGGREGATE",
          paymentVerified: true,
          payment,
        });
      }
      try {
        const boundQuestion = await bindPaymentToQuestion(payment.txHash, queryHash, PAYMENT_BINDING_TTL_MS);
        if (boundQuestion !== queryHash) {
          return errorResponse(409, "This payment is already tied to a different question. Ask the original question again.", {
            code: "PAYMENT_QUERY_MISMATCH",
            paymentVerified: true,
            payment,
          });
        }
      } catch (error) {
        if (!(error instanceof SharedStoreError)) throw error;
        logQueryFailure("payment-binding", error);
        return storeUnavailableResponse(payment);
      }
    }

    // 3. Resolve the dataset. Sample data comes from the server catalog and
    // published data from Supabase. In enclave mode, published data stays
    // sealed on this server and is only opened inside the enclave.
    failureStage = "dataset-resolution";
    const enclaveMode = isEnclaveMode();
    const sampleDataset = resolvedVault ? getDemoVaultDataset(resolvedVault.id) : undefined;
    if (resolvedVault && !sampleDataset) {
      return errorResponse(500, "The sample vault dataset is unavailable on this server.");
    }
    const vaultKey = resolvedVault?.id ?? resolvedPublishedVault?.id ?? null;
    let evidenceRowCount = resolvedPublishedVault?.rowCount ?? resolvedVault?.rows ?? null;
    let evidenceFieldCount = resolvedVault?.sampleColumns?.length ?? null;

    let datasetFingerprint: string;
    let runAnswer: () => Promise<RouteAnswer>;

    if (enclaveMode) {
      // Only vaults can be queried: a raw dataset sent by the client would be
      // plaintext on this server.
      if (!vaultKey || action === "prepare") {
        return errorResponse(400, "Questions must target a sample or published vault.", { code: "VAULT_REQUIRED" });
      }
      const questionError = validateQuestion(submittedQuery);
      if (questionError) return questionError;
      const datasetInput: EnclaveDatasetInput = resolvedSealedDataset
        ? { kind: "sealed", sealed: resolvedSealedDataset }
        : { kind: "sample", text: sampleDataset ?? "" };
      datasetFingerprint = `vault:${vaultKey}`;
      runAnswer = () => answerInEnclave(datasetInput, submittedQuery, requestStartedAt);
    } else {
      const fileText = typeof fileContent === "string" ? fileContent.trim() : "";
      const datasetText = typeof rawDataset === "string" ? rawDataset.trim() : "";
      const datasetContext = resolvedVault
        ? sampleDataset ?? ""
        : resolvedPublishedVault
          ? resolvedPublishedDataset ?? ""
          : fileText || datasetText;
      const cachedPrepared = getCachedPreparedDataset(datasetId);
      if (!datasetContext && !cachedPrepared) {
        return errorResponse(400, "An uploaded dataset is required for inference.");
      }

      if (action === "prepare") {
        failureStage = "dataset-preparation";
        let preparedForPreview: PreparedDataset;
        try {
          preparedForPreview = prepareDataset(datasetContext);
        } catch (error) {
          return errorResponse(422, error instanceof Error ? error.message : "Dataset rejected.");
        }
        return NextResponse.json({
          success: true,
          datasetId: cachePreparedDataset(preparedForPreview),
          rowCount: preparedForPreview.rowCount,
          columnCount: preparedForPreview.columns.length,
          antiProbingCheck: "ALLOWED",
          noiseAdded: false,
          receiptId,
          payment,
        });
      }

      const questionError = validateQuestion(submittedQuery);
      if (questionError) return questionError;

      failureStage = "dataset-preparation";
      let prepared = cachedPrepared;
      if (!prepared) {
        try {
          prepared = prepareDataset(datasetContext);
        } catch (error) {
          return errorResponse(422, error instanceof Error ? error.message : "Dataset rejected.", {
            antiProbingCheck: "BLOCKED",
            noiseAdded: false,
          });
        }
        if (typeof datasetId === "string") cachePreparedDataset(prepared, datasetId);
      }
      evidenceRowCount = prepared.rowCount;
      evidenceFieldCount = prepared.columns.length;

      failureStage = "inference-configuration";
      const apiKey = process.env.NEAR_AI_API_KEY?.trim();
      if (!apiKey) {
        console.error("[Query] Inference configuration is missing.", {
          stage: failureStage,
          code: "MISSING_NEAR_AI_API_KEY",
          env: "NEAR_AI_API_KEY",
        });
        return errorResponse(
          503,
          "Inference is not configured on this server. Set NEAR_AI_API_KEY (see README) and retry. Your payment transaction is still valid.",
          { code: "INFERENCE_NOT_CONFIGURED", paymentVerified: true, payment },
        );
      }
      datasetFingerprint = vaultKey ? `vault:${vaultKey}` : getDatasetFingerprint(prepared.datasetForInference);
      const preparedDataset = prepared;
      runAnswer = async () => {
        const outcome = await answerPrivately({
          apiKey,
          prepared: preparedDataset,
          question: submittedQuery,
          startedAt: requestStartedAt,
          inferenceDeadlineMs: INFERENCE_DEADLINE_MS,
          responseDeadlineMs: RESPONSE_DEADLINE_MS,
        });
        return outcome.kind === "answered"
          ? { kind: "answered", insight: outcome.insight, privacy: outcome.privacy, enclave: null }
          : outcome;
      };
    }

    // 5. Anti-probing checks across this buyer's recent questions.
    const activeUserId = payment.payerAccountId || `${String(userId ?? agentId ?? "anonymous")}`;
    failureStage = "query-guardrails";
    const historyCheck = await checkQueryHistoryLimit(datasetFingerprint, submittedQuery, activeUserId, receiptId);
    if (historyCheck.blocked) {
      console.warn("[Query] Blocked by query history limit.", { stage: failureStage });
      return NextResponse.json(
        { success: false, error: historyCheck.message, antiProbingCheck: "BLOCKED", noiseAdded: false },
        { status: 429 },
      );
    }

    if (await isQueryPatternFlagged(req, datasetFingerprint, submittedQuery, receiptId)) {
      console.warn("[Query] Blocked by query pattern guard.", { stage: failureStage });
      return NextResponse.json(
        {
          success: false,
          error: "Query pattern flagged for potential data reconstruction. Request generalized.",
          antiProbingCheck: "BLOCKED",
          noiseAdded: false,
        },
        { status: 429 },
      );
    }

    // 6. Claim the payment so it can't buy two answers at once.
    const paymentHashes = feeTxHash ? [payment.txHash, feeTxHash] : [payment.txHash];
    try {
      await claimPayment(paymentHashes);
    } catch (claimError) {
      if (claimError instanceof SharedStoreError) {
        logQueryFailure("payment-claim", claimError);
        return storeUnavailableResponse(payment);
      }
      if (claimError instanceof PaymentVerificationError) {
        console.warn("[Query] Payment claim rejected:", { stage: "payment-claim", code: claimError.code });
        return errorResponse(claimError.status, claimError.message, {
          code: claimError.code,
          paymentVerified: true,
          payment,
        });
      }
      throw claimError;
    }

    // 7. Answer privately (here, or inside the enclave).
    failureStage = "inference";
    try {
      const outcome = await runAnswer();

      if (outcome.kind !== "answered") {
        // Refused or withheld by the aggregate-only guard, or the dataset
        // couldn't be read: the buyer keeps the payment for another question.
        await releasePaymentClaim(paymentHashes);
        await unbindPayment(payment.txHash).catch(() => undefined);
        if (outcome.kind === "dataset-rejected") {
          console.error("[Query] Vault dataset rejected.", { stage: "dataset-preparation" });
          return errorResponse(422, "This vault can't answer questions right now.", { code: "VAULT_DATA_UNAVAILABLE", paymentVerified: true, payment });
        }
        console.warn("[Query] Aggregate-only guard applied.", { kind: outcome.kind, reason: outcome.reason });
        return errorResponse(422, guardMessage(outcome.reason), {
          code: outcome.kind === "refused" ? "QUESTION_NOT_AGGREGATE" : "ANSWER_WITHHELD",
          paymentVerified: true,
          payment,
        });
      }

      // 8. Record the payment as used before releasing the answer. If that
      // can't be recorded, the answer is withheld: otherwise the same payment
      // could be replayed for another one.
      try {
        await settlePayments(paymentHashes, SETTLED_PAYMENT_TTL_MS);
      } catch (error) {
        if (!(error instanceof SharedStoreError)) throw error;
        logQueryFailure("payment-settlement", error);
        await releasePaymentClaim(paymentHashes);
        return storeUnavailableResponse(payment);
      }
      const activity = {
        kind: "query" as const,
        accountId: payment.payerAccountId,
        vaultId: vaultKey,
        vaultTitle: resolvedVault?.title ?? resolvedPublishedVault?.title ?? null,
        receiverId: receiver,
        amountNear: payment.amountNear,
        paymentTx: payment.txHash,
        feeNear: platformFeeTxHash ? paidFeeNear : null,
        feeTx: platformFeeTxHash,
      };
      after(() => recordActivity(activity));
      return successResponse({
        insight: outcome.insight,
        receiptId,
        payment,
        privacy: outcome.privacy,
        enclave: outcome.enclave,
        answerReceipt: createAnswerReceipt({
          insight: outcome.insight,
          receiptId,
          vaultId: vaultKey,
          rowCount: evidenceRowCount,
          fieldCount: evidenceFieldCount,
          privacy: outcome.privacy,
          platformFeeTxHash,
        }),
      });
    } catch (err) {
      // The payment was valid but no answer was produced, so release the claim
      // and let the buyer retry with the same transfer instead of paying twice.
      await releasePaymentClaim(paymentHashes);
      if (err instanceof PrivateTransportError) {
        // Nothing was sent: the question only leaves over OHTTP to a verified enclave.
        console.warn("[Query] Prompt withheld; private channel unavailable.", {
          stage: err.stage,
          totalMs: Date.now() - requestStartedAt,
        });
        return errorResponse(
          503,
          err.stage === "attestation-unavailable"
            ? "The AI enclave couldn't be verified in time, so your question wasn't sent. Your payment is confirmed; retry in a moment."
            : "The encrypted channel to the AI enclave failed, so your question wasn't sent. Your payment is confirmed; retry in a moment.",
          { code: "ENCLAVE_UNAVAILABLE", paymentVerified: true, payment },
        );
      }
      if (err instanceof EnclaveError) {
        console.error("[Query] Data enclave unavailable.", { stage: err.stage, totalMs: Date.now() - requestStartedAt });
        return errorResponse(
          503,
          "BlindSight's data enclave couldn't be verified, so your question wasn't sent. Your payment is confirmed; retry in a moment.",
          { code: "ENCLAVE_UNAVAILABLE", paymentVerified: true, payment },
        );
      }
      const cause = err instanceof InferenceFailure ? err.cause : err;
      const apiKey = process.env.NEAR_AI_API_KEY?.trim() ?? "";
      const credentialFailure = getInferenceCredentialFailure(cause);
      if (credentialFailure) {
        logInferenceFailure("inference-authentication", cause, apiKey);
        return errorResponse(503, credentialFailure.message, {
          code: credentialFailure.code,
          paymentVerified: true,
          payment,
        });
      }
      const aborted = err instanceof InferenceFailure && err.aborted;
      logInferenceFailure(aborted ? "inference-timeout" : "inference", cause, apiKey);
      console.error("[Query] Inference attempts exhausted:", {
        attempts: err instanceof InferenceFailure ? err.attempts : null,
        model: MODEL,
        totalMs: Date.now() - requestStartedAt,
      });
      return errorResponse(
        aborted ? 504 : 502,
        aborted
          ? "NEAR AI inference timed out. Your payment is confirmed; retry the query in a moment."
          : "NEAR AI inference failed. Your payment is confirmed; retry the query in a moment.",
        { code: "INFERENCE_FAILED", paymentVerified: true, payment },
      );
    } finally {
      // Drop the prepared dataset reference once this paid inference finishes.
      deleteCachedPreparedDataset(datasetId);
    }
  } catch (err) {
    // Catch-all guardrail preventing HTML 500 pages. Return a generic message
    // so internal errors can never echo dataset or file details to the client.
    logQueryFailure(failureStage, err);
    return NextResponse.json(
      { success: false, error: "Internal server error while processing the query." },
      { status: 500 },
    );
  }
}
