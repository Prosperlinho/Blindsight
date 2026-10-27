import OpenAI from "openai";

const MODEL = "zai-org/GLM-5.1-FP8";
const MAX_DATASET_LENGTH = 60_000;
const MAX_QUERY_LENGTH = 2_000;

const SYSTEM_PROMPT = `You are a research model operating in a hardware-isolated confidential-computing environment. Analyze only the dataset and question supplied in this request. Do not claim access to data that is not present, do not reveal records beyond what is necessary to answer, and return a concise, evidence-grounded insight. This instruction describes the intended execution policy; it is not itself proof of hardware isolation.`;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Request body must include dataset and query strings." }, { status: 400 });
  }

  const { dataset, query } = body as Record<string, unknown>;
  if (typeof dataset !== "string" || !dataset.trim()) {
    return Response.json({ error: "A non-empty dataset is required." }, { status: 400 });
  }
  if (typeof query !== "string" || !query.trim()) {
    return Response.json({ error: "A non-empty query is required." }, { status: 400 });
  }
  if (dataset.length > MAX_DATASET_LENGTH || query.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: "Dataset or query exceeds the supported MVP size." }, { status: 413 });
  }

  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "NEAR_AI_API_KEY is not configured on the server." }, { status: 503 });
  }

  try {
    const client = new OpenAI({
      baseURL: "https://cloud-api.near.ai/v1",
      apiKey,
    });
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Dataset:\n${dataset}\n\nResearch query:\n${query}` },
      ],
    });

    const insight = completion.choices[0]?.message?.content?.trim();
    if (!insight) {
      return Response.json({ error: "The inference gateway returned no insight." }, { status: 502 });
    }

    return Response.json({
      insight,
      attestationToken: "mock_intel_tdx_token_8xJp2",
    });
  } catch {
    return Response.json({ error: "NEAR AI Cloud inference failed." }, { status: 502 });
  }
}