import { createHash } from "node:crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");
import OpenAI from "openai";
import { attestedJsonResponse } from "@/lib/attestedResponse";
import {
  cachePreparedDataset,
  DATASET_QUALITY_ERROR,
  getCachedPreparedDataset,
  prepareDataset,
  type PreparedDataset,
} from "@/lib/datasetQuality";

const MODEL = "zai-org/GLM-5.1-FP8";
const MAX_DATASET_LENGTH = 60_000;
const MAX_QUERY_LENGTH = 2_000;
const DATASET_TRUNCATION_NOTE = "[Dataset truncated for MVP demo]";
const INFERENCE_TIMEOUT_MS = 15_000;
const MOCK_ATTESTATION_TOKEN = "mock_intel_tdx_token_8xJp2";
const TIMEOUT_FALLBACK_INSIGHT = "Mock insight: Inference gateway timed out, returning fallback analysis.";
const QUERY_WINDOW_MS = 10 * 60 * 1000;
const MAX_QUERY_MATCHES = 5;
const MAX_QUERY_PATTERN_KEYS = 2_000;
const MAX_REQUESTS_PER_WINDOW = 5;
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

const SYSTEM_PROMPT = `You are a research model operating in a hardware-isolated confidential-computing environment. Analyze only the dataset and question supplied in this request. Do not claim access to data that is not present, do not reveal records beyond what is necessary to answer, and return a concise, evidence-grounded insight. This instruction describes the intended execution policy; it is not itself proof of hardware isolation.`;

type QueryPattern = { terms: string[]; timestamp: number; query: string; hash: string };

type QueryHistoryEntry = {
  timestamp: number;
  hash: string;
  query: string;
};

const queryPatterns = new Map<string, QueryPattern[]>();
const queryHistory = new Map<string, QueryHistoryEntry[]>();
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
  const repeatedHashMatches = entries.filter((entry) => entry.hash === signature).length;
  const repetitiveExtraction = isRepetitiveExtractionPrompt(query)
    && entries.some((entry) => isRepetitiveExtractionPrompt(entry.query) && queriesOverlap(queryTerms(query), queryTerms(entry.query)));

  if (entries.length >= MAX_REQUESTS_PER_WINDOW || repeatedHashMatches >= 1 || repetitiveExtraction) {
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

function applyDemoNoise(insight: string) {
  const isNumericSummary = /\b(sum|total|average|mean|median|count|aggregate|rows|records|amount|value|avg)\b/i.test(insight);
  const match = insight.match(/-?\d+(?:\.\d+)?/);
  if (!match || !isNumericSummary) {
    return { insight, noiseAdded: false };
  }

  const demoNoiseParameter = 0.5;
  const noise = (Math.random() - 0.5) * (1 / demoNoiseParameter);
  const originalValue = Number(match[0]);
  const noisyValue = Number((originalValue + noise).toFixed(2));
  const updatedInsight = insight.replace(match[0], String(noisyValue));

  return { insight: updatedInsight, noiseAdded: true };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return attestedJsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  if (!body || typeof body !== "object") {
    return attestedJsonResponse({ error: "Request body must include a query and dataset metadata." }, 400);
  }

  const {
    action,
    dataset: rawDataset,
    datasetId,
    query,
    fileName,
    fileContent,
    userId,
    agentId,
  } = body as Record<string, unknown>;

  if (action === "prepare") {
    try {
      const prepared = prepareDataset(rawDataset);
      return attestedJsonResponse({
        datasetId: cachePreparedDataset(prepared),
        rowCount: prepared.rowCount,
        columnCount: prepared.columns.length,
        datasetFallback: prepared.isFallback,
        antiProbingCheck: "PASSED",
        noiseAdded: false,
      });
    } catch {
      return attestedJsonResponse({ error: DATASET_QUALITY_ERROR, antiProbingCheck: "BLOCKED", noiseAdded: false }, 400);
    }
  }

  if (action === "extract-pdf") {
    const pdfSource = typeof fileContent === "string" ? fileContent : "";
    const safeName = typeof fileName === "string" ? fileName : "document.pdf";

    if (!pdfSource) {
      return attestedJsonResponse({ error: "A PDF payload is required for extraction.", antiProbingCheck: "BLOCKED", noiseAdded: false }, 400);
    }

    try {
      const buffer = Buffer.from(pdfSource, "base64");
      const parsedData = await pdfParse(buffer);
      const extractedText = (parsedData?.text ?? "").trim();

      if (!extractedText) {
        throw new Error("No readable text found in the PDF.");
      }

      return attestedJsonResponse({
        extractedText,
        fileName: safeName,
        antiProbingCheck: "PASSED",
        noiseAdded: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PDF extraction failed.";
      return attestedJsonResponse({
        error: `Unable to extract text from PDF: ${message}. The file may be corrupted or password-protected.`,
        antiProbingCheck: "BLOCKED",
        noiseAdded: false,
      }, 400);
    }
  }

  if (typeof query !== "string" || !query.trim()) {
    return attestedJsonResponse({ error: "A non-empty query is required.", antiProbingCheck: "BLOCKED", noiseAdded: false }, 400);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return attestedJsonResponse({ error: "Query exceeds the supported MVP size.", antiProbingCheck: "BLOCKED", noiseAdded: false }, 413);
  }

  let prepared = getCachedPreparedDataset(datasetId);
  if (!prepared) {
    if (typeof datasetId === "string" && (typeof rawDataset !== "string" || !rawDataset.trim())) {
      return attestedJsonResponse({ error: "Prepared dataset expired; upload it again.", antiProbingCheck: "BLOCKED", noiseAdded: false }, 409);
    }
    try {
      prepared = prepareDataset(rawDataset);
    } catch {
      return attestedJsonResponse({ error: DATASET_QUALITY_ERROR, antiProbingCheck: "BLOCKED", noiseAdded: false }, 400);
    }
    if (typeof datasetId === "string") cachePreparedDataset(prepared, datasetId);
  }

  const activeUserId = `${String(userId ?? agentId ?? "anonymous")}`;
  const historyCheck = checkQueryHistoryLimit(prepared, query, activeUserId);
  if (historyCheck.blocked) {
    return attestedJsonResponse({
      error: historyCheck.message,
      antiProbingCheck: "BLOCKED",
      noiseAdded: false,
    }, 429);
  }

  if (isQueryPatternFlagged(request, prepared, query)) {
    return attestedJsonResponse({
      error: "Query pattern flagged for potential data reconstruction. Request generalized.",
      antiProbingCheck: "BLOCKED",
      noiseAdded: false,
    }, 429);
  }

  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) {
    return attestedJsonResponse({ error: "NEAR_AI_API_KEY is not configured on the server.", antiProbingCheck: "PASSED", noiseAdded: false }, 503);
  }

  const dataset = prepared.datasetForInference.length > MAX_DATASET_LENGTH
    ? `${prepared.datasetForInference.slice(0, MAX_DATASET_LENGTH - DATASET_TRUNCATION_NOTE.length)}${DATASET_TRUNCATION_NOTE}`
    : prepared.datasetForInference;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

  try {
    const client = new OpenAI({ baseURL: "https://cloud-api.near.ai/v1", apiKey });
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Dataset:\n${dataset}\n\nResearch query:\n${query}` },
      ],
    }, { signal: controller.signal, maxRetries: 0 });

    const insight = completion.choices[0]?.message?.content?.trim();
    if (!insight) {
      return attestedJsonResponse({ error: "The inference gateway returned no insight.", antiProbingCheck: "PASSED", noiseAdded: false }, 502);
    }

    const protectedInsight = applyDemoNoise(insight);
    return attestedJsonResponse({
      insight: protectedInsight.insight,
      attestationToken: MOCK_ATTESTATION_TOKEN,
      datasetFallback: prepared.isFallback,
      antiProbingCheck: "PASSED",
      noiseAdded: protectedInsight.noiseAdded,
    });
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      return attestedJsonResponse({
        insight: TIMEOUT_FALLBACK_INSIGHT,
        attestationToken: MOCK_ATTESTATION_TOKEN,
        datasetFallback: prepared.isFallback,
        fallback: true,
        antiProbingCheck: "PASSED",
        noiseAdded: false,
      });
    }
    return attestedJsonResponse({ error: "NEAR AI Cloud inference failed.", antiProbingCheck: "PASSED", noiseAdded: false }, 502);
  } finally {
    clearTimeout(timeoutId);
  }
}