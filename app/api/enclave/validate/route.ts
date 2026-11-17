import { NextResponse } from "next/server";
import { isSealedDataset, type EnclaveValidateResponse } from "@/lib/enclaveProtocol";
import { callEnclave, EnclaveError, getVerifiedEnclave, isEnclaveMode } from "@/lib/enclaveClient";

const ENCLAVE_VALIDATE_TIMEOUT_MS = 20_000;

/**
 * Checks a sealed dataset inside the enclave before the publisher pays the
 * publishing fee. Only the row and column counts come back.
 */
export async function POST(request: Request) {
  if (!isEnclaveMode()) {
    return NextResponse.json({ error: "Enclave mode is not enabled." }, { status: 404 });
  }
  let sealed: unknown;
  try {
    sealed = ((await request.json()) as { sealedDataset?: unknown }).sealedDataset;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!isSealedDataset(sealed)) {
    return NextResponse.json({ error: "A sealed dataset is required." }, { status: 400 });
  }
  try {
    const enclave = await getVerifiedEnclave();
    if (sealed.enclaveKey !== enclave.sealPublicKey.toString("base64")) {
      return NextResponse.json(
        { error: "The enclave key changed. Reload the page and try again.", code: "ENCLAVE_KEY_CHANGED" },
        { status: 409 },
      );
    }
    const result = await callEnclave<EnclaveValidateResponse>("/validate", { dataset: { kind: "sealed", sealed } }, ENCLAVE_VALIDATE_TIMEOUT_MS);
    if (!result.ok) return NextResponse.json({ error: result.error, code: "DATASET_REJECTED" }, { status: 422 });
    return NextResponse.json({ rowCount: result.rowCount, columnCount: result.columnCount });
  } catch (error) {
    console.error("[Enclave API] Validation failed.", { stage: error instanceof EnclaveError ? error.stage : "unknown" });
    return NextResponse.json(
      { error: "The BlindSight enclave couldn't be reached. Try again in a moment.", code: "ENCLAVE_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
