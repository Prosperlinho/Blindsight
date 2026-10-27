const RATE_PER_ROW_USDC = 0.05;
const MAX_ROW_COUNT = 1_000_000;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Dataset metadata is required." }, { status: 400 });
  }

  const { rowCount, fileCount, fileSizeBytes } = body as Record<string, unknown>;
  if (
    !Number.isInteger(rowCount) ||
    (rowCount as number) < 1 ||
    (rowCount as number) > MAX_ROW_COUNT
  ) {
    return Response.json({ error: "rowCount must be an integer between 1 and 1,000,000." }, { status: 400 });
  }
  if (!Number.isInteger(fileCount) || (fileCount as number) < 1) {
    return Response.json({ error: "fileCount must be a positive integer." }, { status: 400 });
  }
  if (!Number.isInteger(fileSizeBytes) || (fileSizeBytes as number) < 0) {
    return Response.json({ error: "fileSizeBytes must be a non-negative integer." }, { status: 400 });
  }

  const bidAmountInUSDC = ((rowCount as number) * RATE_PER_ROW_USDC).toFixed(2);
  const formattedRows = (rowCount as number).toLocaleString("en-US");
  await new Promise((resolve) => setTimeout(resolve, 500));

  return Response.json({
    bidAmountInUSDC,
    rowCount,
    ratePerRowUSDC: RATE_PER_ROW_USDC.toFixed(2),
    justification: `The agent estimates ${formattedRows} records across ${fileCount} file${fileCount === 1 ? "" : "s"}. At $0.05 per row, the proposed provider payout is ${bidAmountInUSDC} USDC.`,
  });
}