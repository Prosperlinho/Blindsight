export const MOCK_ATTESTATION_PROOF = "AMD-SEV-SNP-Verified-v1.2";

export function attestedJsonResponse(
  payload: Record<string, unknown>,
  status = 200,
) {
  return Response.json(
    { ...payload, attestation_proof: MOCK_ATTESTATION_PROOF },
    {
      status,
      headers: { "X-TEE-Attestation-Proof": MOCK_ATTESTATION_PROOF },
    },
  );
}
