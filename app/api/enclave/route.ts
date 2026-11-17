import { connection, NextResponse } from "next/server";
import { EnclaveError, getVerifiedEnclave, isEnclaveMode } from "@/lib/enclaveClient";

/**
 * Public, verified identity of the BlindSight enclave.
 *
 * Publishers' browsers use `sealPublicKey` to encrypt datasets so only the
 * enclave can read them. The raw attestation (TDX quote, event log,
 * app-compose and nonce) is included so anyone can verify it independently,
 * for example with Phala's dstack-verifier.
 */
export async function GET() {
  await connection();
  if (!isEnclaveMode()) {
    return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const enclave = await getVerifiedEnclave();
    return NextResponse.json({
      enabled: true,
      sealPublicKey: enclave.sealPublicKey.toString("base64"),
      signPublicKey: enclave.signPublicKey.toString("base64"),
      composeHash: enclave.composeHash,
      appId: enclave.appId,
      tcbStatus: enclave.tcbStatus,
      verifiedAt: new Date(enclave.verifiedAt).toISOString(),
      attestation: enclave.attestation,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[Enclave API] Enclave could not be verified.", {
      stage: error instanceof EnclaveError ? error.stage : "unknown",
    });
    return NextResponse.json(
      { enabled: true, error: "The BlindSight enclave couldn't be verified right now. Try again in a moment.", code: "ENCLAVE_UNVERIFIED" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
