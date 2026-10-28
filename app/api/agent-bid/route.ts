import { attestedJsonResponse } from "@/lib/attestedResponse";
import {
  DATASET_QUALITY_ERROR,
  prepareDataset,
} from "@/lib/datasetQuality";

const RATE_PER_ROW_USDC = 0.05;
const MAX_ROW_COUNT = 1_000_000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return attestedJsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const { dataset, fileCount: requestedFileCount, fileSizeBytes } = values;
  let prepared;
  try {
    prepared = prepareDataset(dataset);
  } catch {
    return attestedJsonResponse({ error: DATASET_QUALITY_ERROR }, 400);
  }
  const rowCount = prepared.rowCount;

  const fileCount = Number.isInteger(requestedFileCount) && (requestedFileCount as number) > 0
    ? requestedFileCount as number
    : 1;
  if (fileSizeBytes !== undefined && (!Number.isInteger(fileSizeBytes) || (fileSizeBytes as number) < 0)) {
    return attestedJsonResponse({ error: "fileSizeBytes must be a non-negative integer." }, 400);
  }
  if (rowCount > MAX_ROW_COUNT) {
    return attestedJsonResponse({ error: "Dataset exceeds the supported valuation size." }, 413);
  }

  const bidAmountInUSDC = (rowCount * RATE_PER_ROW_USDC).toFixed(2);
  const formattedRows = rowCount.toLocaleString("en-US");
  await new Promise((resolve) => setTimeout(resolve, 500));

  return attestedJsonResponse({
    bidAmountInUSDC,
    rowCount,
    ratePerRowUSDC: RATE_PER_ROW_USDC.toFixed(2),
    datasetFallback: prepared.isFallback,
    justification: `The agent estimates ${formattedRows} records across ${fileCount} file${fileCount === 1 ? "" : "s"}. At $0.05 per row, the proposed provider payout is ${bidAmountInUSDC} USDC.`,
  });
}