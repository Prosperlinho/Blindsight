# BlindSight

## NEAR Hackathon | Track 3: Privacy & Private AI

**Live app:** [https://blindsight-zeta.vercel.app](https://blindsight-zeta.vercel.app)

BlindSight is a confidential data marketplace on NEAR testnet. Publishers list datasets in sealed
vaults and set a price per question. Buyers, whether people or AI agents, pay in NEAR to ask a
question about a vault. They get an AI answer, never the raw records. The AI runs inside an
attested hardware enclave on NEAR AI Cloud. BlindSight verifies that enclave cryptographically on
every paid question, encrypts the question to it, and shows the buyer a signed receipt.

## 1. The problem

High-value datasets can't be shared safely: financial, medical, security audits. Handing over the
file means losing control of it forever. Keeping it private means nobody can learn from it.
BlindSight sits in between and sells *answers* about a dataset rather than the dataset itself. The
AI that reads the data runs where neither the buyer nor the infrastructure operator can watch.

## 2. What works today

Everything below is live on testnet. There are no mock tokens, fake hashes or simulated balances.

| Area | What actually happens |
| --- | --- |
| Wallets | NEAR Wallet Selector (MyNearWallet, Meteor) on testnet. Balances are read from the public RPC. |
| Paying for a question | One wallet approval signs two native NEAR transfers: the vault price to the publisher (or the treasury for sample vaults), and a 0.01 NEAR platform fee to the treasury. |
| Payment verification | The server fetches both finalized transactions from the RPC. It checks signer, receiver, amount, success and age before any AI runs. |
| Publishing | Publishers upload a CSV, JSON, TXT or PDF and pay a one-time 0.05 NEAR publishing fee. The dataset is encrypted with AES-256-GCM and stored in a private Supabase bucket. Only metadata is listed publicly. |
| Unpublishing | Only the publishing account can remove a vault. It proves ownership with a fresh NEP-413 wallet signature, which the server verifies against a full-access key on chain. |
| Private inference | DeepSeek V3.2 on NEAR AI Cloud, inside Intel TDX with NVIDIA GPU attestation. BlindSight verifies the enclave on every question; see below. |
| Privacy receipt | Each answer shows **Verified private answer**, with details: the Intel check, the model, encryption, the enclave signature and fingerprints. |

## 3. How BlindSight verifies the enclave

BlindSight doesn't take NEAR AI's word that inference is private. It checks the evidence itself:

1. **Fresh attestation.** BlindSight generates a random one-time code and requests NEAR AI's
   attestation report bound to that code.
2. **Intel verification.** The gateway's TDX quote and the model's TDX quote are each verified
   against Intel's certificate chain with `@phala/dcap-qvl`. Accepted TCB states are `UpToDate`
   and `SWHardeningNeeded`. The quotes must contain the one-time code, which proves they are fresh
   rather than replayed. The gateway quote must also contain the gateway's signing key. The GPU
   attestation verdict is recorded too.
3. **Encryption to the enclave.** TLS to `cloud-api.near.ai` terminates outside the enclave: the
   live certificate differs from the attested fingerprint. So BlindSight does not rely on HTTPS.
   It encrypts the question with **Oblivious HTTP** (RFC 9458, using HPKE with X25519 and
   AES-128-GCM) to a key that the attested gateway signed. Only the enclave can decrypt it.
4. **Signed answer.** The enclave signs `sha256(request):sha256(response)` with its attested
   ed25519 key. BlindSight checks that signature against the exact bytes it sent and received.
5. **Receipt.** The results go to the buyer with the answer. Attestations are cached for 10 minutes,
   so only the first question on a fresh server pays the roughly 20-second verification cost.

If a check can't finish in time, the buyer still gets the answer they paid for. The receipt then
shows only what was actually verified; it never claims more.

The implementation is in `lib/privateInference.ts`. HPKE, OHTTP and Binary HTTP are written
directly against the RFCs and the reference client in `nearai/nearai-cloud-verifier`.

## 4. Architecture

```text
Buyer wallet ──(2 NEAR transfers, 1 approval)──► NEAR testnet
     │
     ▼
BlindSight server (Next.js on Vercel)
  1. Verify both transfers via RPC
  2. Load the vault: sample data, or decrypt the published dataset from Supabase
  3. Anti-probing checks on the question
  4. Attest NEAR AI (Intel TDX + GPU, fresh nonce)
  5. OHTTP-encrypt the prompt to the attested key ─────► NEAR AI Cloud enclave
  6. Verify the enclave's signature on the answer ◄───── DeepSeek V3.2 (TDX)
     │
     ▼
Answer + payment proof + privacy receipt ──► buyer
```

## 5. Honest limits

- **BlindSight's own server is not an enclave.** It decrypts the published dataset in memory to
  build the prompt. The path from BlindSight to the model is attested and encrypted, but buyers
  and publishers must still trust BlindSight's server. The receipt says this explicitly. The next
  step is to run the decrypt-and-prompt step inside a TEE so the dataset key never exists outside
  one.
- **Testnet only.** No escrow contract exists; transfers settle directly to the recipients.
- **Replay protection and anti-probing are per server instance.** Both are in-memory. Publishing
  fees are made single-use by a unique database column.
- **Anti-probing is heuristic.** It raises the cost of reconstructing a dataset through many
  narrow questions but doesn't make reconstruction impossible.
- Use synthetic or non-sensitive data.

## 6. NEAR stack

NEAR testnet · Wallet Selector · `near-api-js` (transfers, NEP-413 verification) · FastNear RPC ·
NEAR AI Cloud (private inference, attestation and signature APIs) · NEARBlocks.

## 7. Next steps

1. Move dataset decryption and prompt building into a TEE, so publishers never have to trust
   BlindSight's server.
2. Settle through an escrow contract with refunds for failed answers.
3. Make replay protection and query history network-wide.
4. Expose the full attestation report for independent re-verification.
