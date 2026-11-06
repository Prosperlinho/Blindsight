import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  cachePreparedDataset,
  deleteCachedPreparedDataset,
  getCachedPreparedDataset,
  prepareDataset,
  type PreparedDataset,
} from "@/lib/datasetQuality";
import { getDemoVault } from "@/lib/demoVaults";
import { getDemoVaultDataset } from "@/lib/demoVaultDatasets";
import { getTreasuryAccount, nearToYocto } from "@/lib/paymentConfig";
import {
  PaymentVerificationError,
  verifyNearTransfer,
  type VerifiedNearPayment,
} from "@/lib/paymentVerification";

export const maxDuration = 60;

const MODEL = "zai-org/GLM-5.1-FP8";
const MAX_DATASET_LENGTH = 60_000;
const MAX_QUERY_LENGTH = 2_000;
const DATASET_TRUNCATION_NOTE = "[Dataset truncated to fit the inference context]";
const INFERENCE_TIMEOUT_MS = 45_000;
const NEAR_AI_BASE_URL = "https://cloud-api.near.ai/v1";
const QUERY_WINDOW_MS = 10 * 60 * 1000;
const MAX_QUERY_MATCHES = 5;
const MAX_QUERY_PATTERN_KEYS = 2_000;
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

const SYSTEM_PROMPT = `You are a research assistant analyzing a dataset supplied in this request. Analyze only the dataset and question provided. Do not claim access to data that is not present, do not reveal records beyond what is necessary to answer, and return a concise, evidence-grounded insight.`;

type QueryPattern = { terms: string[]; timestamp: number; query: string; hash: string };

type QueryHistoryEntry = {
  timestamp: number;
  hash: string;
  query: string;
};

const queryPatterns = new Map<string, QueryPattern[]>();
const queryHistory = new Map<string, QueryHistoryEntry[]>();

/**
 * Best-effort replay protection. Serverless instances are ephemeral, so this
 * guards against accidental double-submits on the same instance rather than
 * providing a network-wide guarantee. The README documents this limitation.
 */
const settledPayments = new Map<string, number>();
const SETTLED_PAYMENT_TTL_MS = 24 * 60 * 60 * 1000;

function claimPayment(txHash: string) {
  const now = Date.now();
  for (const [hash, timestamp] of settledPayments) {
    if (now - timestamp > SETTLED_PAYMENT_TTL_MS) settledPayments.delete(hash);
  }
  if (settledPayments.has(txHash)) {
    throw new PaymentVerificationError(
      "This payment transaction has already been used for a query. Each transfer unlocks one answer.",
      "TX_REPLAYED",
      409,
    );
  }
  settledPayments.set(txHash, now);
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

function normalizeQueryHash(query: string) {
  return createHash("sha256").update(query.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

function getDatasetFingerprint(dataset: string) {
  return createHash("sha256").update(dataset).digest("hex");
}

function isQueryPatternFlagged(request: Request, dataset: PreparedDataset, query: string) {
  const requester = request.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  const datasetFingerprint = getDatasetFingerprint(dataset.datasetForInference);
  const patternKey = createHash("sha256").update(`${requester}:${datasetFingerprint}`).digest("hex");
  const now = Date.now();
  const history = (queryPatterns.get(patternKey) ?? []).filter((entry) => now - entry.timestamp < QUERY_WINDOW_MS);
  const terms = queryTerms(query);
  const overlappingCount = history.filter((entry) => queriesOverlap(entry.terms, terms)).length;
  const flagged = (isHyperSpecific(query, terms) || overlappingCount > 0) && overlappingCount >= MAX_QUERY_MATCHES;

  history.push({ terms, timestamp: now, hash: normalizeQueryHash(query), query });
  queryPatterns.set(patternKey, history.slice(-30));
  while (queryPatterns.size > MAX_QUERY_PATTERN_KEYS) {
    const oldestKey = queryPatterns.keys().next().value;
    if (!oldestKey) break;
    queryPatterns.delete(oldestKey);
  }
  return flagged;
}

function checkQueryHistoryLimit(dataset: PreparedDataset, query: string, userId: string) {
  const datasetFingerprint = getDatasetFingerprint(dataset.datasetForInference);
  const key = `${userId}:${datasetFingerprint}`;
  const now = Date.now();
  const entries = (queryHistory.get(key) ?? []).filter((entry) => now - entry.timestamp < QUERY_WINDOW_MS);
  const signature = normalizeQueryHash(query);
  const repetitiveExtraction = isRepetitiveExtractionPrompt(query)
    && entries.some((entry) => isRepetitiveExtractionPrompt(entry.query) && queriesOverlap(queryTerms(query), queryTerms(entry.query)));

  if (entries.length >= MAX_REQUESTS_PER_WINDOW || repetitiveExtraction) {
    entries.push({ timestamp: now, hash: signature, query });
    queryHistory.set(key, entries.slice(-50));
    return {
      blocked: true,
      message: "Potential probing attack detected. Rate limit applied to protect privacy.",
    };
  }

  entries.push({ timestamp: now, hash: signature, query });
  queryHistory.set(key, entries.slice(-50));
  return { blocked: false, message: "OK" };
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

function successResponse({
  insight,
  receiptId,
  payment,
}: {
  insight: string;
  receiptId: string;
  payment: VerifiedNearPayment;
}) {
  const attestationToken = `simulated-tee-${createHash("sha256")
    .update(`${payment.txHash}:${insight}`)
    .digest("hex")
    .slice(0, 32)}`;

  // Privacy guardrail: only the generated insight and payment settlement
  // metadata leave the server. Dataset text, raw file buffers, file names,
  // and any other file metadata must never be returned to the client.
  return NextResponse.json({
    success: true,
    insight,
    receiptId,
    settlementType: "VERIFIED_NEAR_TRANSFER",
    attestationToken,
    payment: {
      verified: true,
      network: payment.network,
      txHash: payment.txHash,
      payerAccountId: payment.payerAccountId,
      receiverId: payment.receiverId,
      amountNear: payment.amountNear,
      amountYocto: payment.amountYocto,
      blockHash: payment.blockHash,
      blockHeight: payment.blockHeight,
      verifiedAt: payment.verifiedAt,
      explorerUrl: `https://testnet.nearblocks.io/txns/${payment.txHash}`,
    },
    inference: {
      provider: "NEAR AI Cloud",
      model: MODEL,
      endpoint: NEAR_AI_BASE_URL,
      execution: "server-side inference",
      teeAttestationVerified: false,
      note: "BlindSight does not independently verify hardware attestation in this prototype. The enclave workflow shown in the UI is simulated.",
    },
    attestation: {
      token: attestationToken,
      simulated: true,
      note: "Simulated attestation token derived from the payment hash and the answer.",
    },
    enclave: {
      simulated: true,
      datasetRetention: "discarded-after-inference",
      note: "The prepared dataset is dropped from the server-side preparation cache after this inference. This mimics an enclave wiping its working copy; it is not hardware isolation.",
    },
    real: [
      "NEAR testnet wallet signature",
      "Native NEAR transfer verified on-chain",
      "NEAR AI Cloud inference request",
    ],
    simulated: [
      "Confidential enclave / TEE hardware attestation",
      "Dataset discarded from the server working set after inference",
      "Publisher payout (fees go to the BlindSight demo treasury)",
    ],
  });
}

export async function POST(req: NextRequest) {
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

    // 2. Require a real NEAR testnet payment and verify it against the public
    // RPC. Inference never starts for an unverified transfer.
    const txHash = typeof rawTxHash === "string" ? rawTxHash.trim() : "";
    const payer = typeof payerAccountId === "string" ? payerAccountId.trim() : "";

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

    const resolvedVault = typeof vaultId === "string" ? getDemoVault(vaultId) : undefined;
    const expectedPriceNear = resolvedVault
      ? resolvedVault.priceNear
      : typeof queryPrice === "string" || typeof queryPrice === "number"
        ? String(queryPrice)
        : "";

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

    let payment: VerifiedNearPayment;
    try {
      payment = await verifyNearTransfer({
        txHash,
        payerAccountId: payer,
        expectedReceiver: getTreasuryAccount(),
        minimumYocto,
      });
    } catch (verificationError) {
      if (verificationError instanceof PaymentVerificationError) {
        return errorResponse(verificationError.status, verificationError.message, {
          code: verificationError.code,
          paymentVerified: false,
        });
      }
      throw verificationError;
    }

    const receiptId = payment.txHash;

    // 3. Resolve the dataset. Sample vaults are resolved from the server-side
    // catalog so their rows are never requested from (or returned to) the
    // browser. Session-published vaults send their own dataset, and there is
    // still no seeded fallback.
    const sampleDataset = resolvedVault ? getDemoVaultDataset(resolvedVault.id) : undefined;
    const fileText = typeof fileContent === "string" ? fileContent.trim() : "";
    const datasetText = typeof rawDataset === "string" ? rawDataset.trim() : "";
    const datasetContext = resolvedVault
      ? sampleDataset ?? ""
      : fileText || datasetText;
    const cachedPrepared = getCachedPreparedDataset(datasetId);

    if (resolvedVault && !datasetContext) {
      return errorResponse(500, "The sample vault dataset is unavailable on this server.");
    }

    if (!datasetContext && !cachedPrepared) {
      return errorResponse(400, "An uploaded dataset is required for inference.");
    }

    // 4. Dataset preparation
    if (action === "prepare") {
      let prepared: PreparedDataset;
      try {
        prepared = prepareDataset(datasetContext);
      } catch (error) {
        return errorResponse(422, error instanceof Error ? error.message : "Dataset rejected.");
      }

      return NextResponse.json({
        success: true,
        datasetId: cachePreparedDataset(prepared),
        rowCount: prepared.rowCount,
        columnCount: prepared.columns.length,
        antiProbingCheck: "ALLOWED",
        noiseAdded: false,
        receiptId,
        payment,
      });
    }

    // 5. Validate query and prepare the dataset for inference
    if (typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { success: false, error: "A non-empty query is required.", antiProbingCheck: "BLOCKED", noiseAdded: false },
        { status: 400 },
      );
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { success: false, error: "Query exceeds the supported MVP size.", antiProbingCheck: "BLOCKED", noiseAdded: false },
        { status: 413 },
      );
    }

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

    const activeUserId = payment.payerAccountId || `${String(userId ?? agentId ?? "anonymous")}`;
    const historyCheck = checkQueryHistoryLimit(prepared, query, activeUserId);
    if (historyCheck.blocked) {
      return NextResponse.json(
        { success: false, error: historyCheck.message, antiProbingCheck: "BLOCKED", noiseAdded: false },
        { status: 429 },
      );
    }

    if (isQueryPatternFlagged(req, prepared, query)) {
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

    // 6. Run the LLM inference against the prepared dataset
    const apiKey = process.env.NEAR_AI_API_KEY;
    if (!apiKey) {
      console.error("[TEE Route] NEAR_AI_API_KEY is not configured.");
      return errorResponse(
        503,
        "Inference is not configured on this server. Set NEAR_AI_API_KEY (see README) and retry. Your payment transaction is still valid.",
        { code: "INFERENCE_NOT_CONFIGURED", paymentVerified: true, payment },
      );
    }

    try {
      claimPayment(payment.txHash);
    } catch (claimError) {
      if (claimError instanceof PaymentVerificationError) {
        return errorResponse(claimError.status, claimError.message, {
          code: claimError.code,
          paymentVerified: true,
          payment,
        });
      }
      throw claimError;
    }

    const promptContext = datasetContext || prepared.datasetForInference;
    const dataset = promptContext.length > MAX_DATASET_LENGTH
      ? `${promptContext.slice(0, MAX_DATASET_LENGTH - DATASET_TRUNCATION_NOTE.length)}${DATASET_TRUNCATION_NOTE}`
      : promptContext;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

    try {
      const client = new OpenAI({ baseURL: NEAR_AI_BASE_URL, apiKey });
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Dataset context:\n${dataset}\n\nResearch query:\n${query}` },
        ],
      }, { signal: controller.signal, maxRetries: 0 });

      const generatedInsight = completion.choices[0]?.message?.content?.trim();
      if (!generatedInsight) {
        throw new Error("The inference gateway returned no insight.");
      }

      // 7. Return successful insight payload with real-vs-simulated metadata
      return successResponse({
        insight: generatedInsight,
        receiptId,
        payment,
      });
    } catch (err) {
      // The payment was valid but inference failed, so release the claim and
      // let the buyer retry with the same transfer instead of paying twice.
      settledPayments.delete(payment.txHash);
      const aborted = controller.signal.aborted;
      console.error(
        "[NEAR AI Error]:",
        err instanceof Error ? err.message : "Inference request failed",
      );
      return errorResponse(
        aborted ? 504 : 502,
        aborted
          ? "NEAR AI inference timed out. Your payment is confirmed; retry the query in a moment."
          : "NEAR AI inference failed. Your payment is confirmed; retry the query in a moment.",
        { code: "INFERENCE_FAILED", paymentVerified: true, payment },
      );
    } finally {
      clearTimeout(timeoutId);
      // Simulated enclave lifecycle: drop the prepared dataset reference once
      // this paid inference finishes. A later request cannot reuse it.
      deleteCachedPreparedDataset(datasetId);
    }
  } catch (err) {
    // Catch-all guardrail preventing HTML 500 pages. Return a generic message
    // so internal errors can never echo dataset or file details to the client.
    console.error(
      "[TEE Route Uncaught Exception]:",
      err instanceof Error ? err.message : "unknown error",
    );
    return NextResponse.json(
      { success: false, error: "Internal server error while processing the query." },
      { status: 500 },
    );
  }
}
