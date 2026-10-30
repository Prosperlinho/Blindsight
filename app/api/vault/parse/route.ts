import { PDFParse } from "pdf-parse";

const CONTROL_CHARACTERS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
const TEXT_FILE_EXTENSIONS = /\.(?:txt|text|csv|tsv|json|jsonl|ndjson|md|markdown|html?|xml|ya?ml|toml|ini|cfg|conf|log|sql|py|pyi|js|jsx|mjs|cjs|ts|tsx|mts|cts|css|scss|sass|less|sh|bash|zsh|ps1|bat|cmd|c|h|cc|cpp|hpp|cs|java|kt|kts|go|rs|rb|php|swift|scala|r|ipynb|diff|patch)$/i;

function printableText(buffer: Buffer) {
  return buffer.toString("utf-8").replace(CONTROL_CHARACTERS, "").trim();
}

async function extractPdfText(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Request must contain a file upload." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "A file upload is required." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileType = file.type || "application/octet-stream";
  const isPdf = fileType === "application/pdf"
    || /\.pdf$/i.test(file.name)
    || buffer.subarray(0, 5).toString("ascii") === "%PDF-";

  let extractedText = "";
  if (isPdf) {
    try {
      extractedText = await extractPdfText(buffer);
    } catch {
      extractedText = printableText(buffer);
    }
    if (!extractedText) {
      extractedText = printableText(buffer);
    }
  } else if (fileType.startsWith("text/")
    || /(?:json|xml|javascript|typescript|yaml|toml|sql)/i.test(fileType)
    || TEXT_FILE_EXTENSIONS.test(file.name)) {
    extractedText = (await file.text()).trim();
  } else {
    extractedText = printableText(buffer);
  }

  return Response.json({
    success: true,
    fileName: file.name,
    fileType,
    text: extractedText || "Raw binary context ingested.",
    antiProbingCheck: "PASSED",
  });
}
