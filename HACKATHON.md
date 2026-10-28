# BlindSight

## NEAR Hackathon | Track 3: Privacy & Private AI

BlindSight is a confidential-data marketplace concept that connects data providers with researchers and AI agents. It is built around a simple exchange: providers retain control of sensitive datasets, researchers pay for useful analysis, and confidential compute is intended to keep raw records private throughout inference.

## 1. Vision & Value Proposition

Private financial, medical, and other high-value datasets are difficult to monetize safely. Providers face a trust gap: sharing raw records can expose personal information, while withholding them prevents useful research and AI analysis.

BlindSight's vision is a decentralized confidential AI marketplace where a provider can make a dataset available for an approved research query without exposing raw plaintext to the researcher or marketplace operator. In the production design, the provider encrypts the payload to a TEE's public key before transmission. The TEE processes the protected data and query, returns a constrained insight, and produces verifiable evidence of the execution environment. Researchers fund the work, and providers receive payment for approved use of their data.

This architecture aims to align incentives across the exchange:

- **Data providers** retain control and earn from their data without distributing readable source records.
- **Researchers and AI agents** gain access to useful insights without directly handling the underlying sensitive dataset.
- **The marketplace** coordinates queries, confidential execution, verification, and settlement through composable infrastructure.

The current hackathon build demonstrates the end-to-end product flow. The security and settlement guarantees described as production goals below are not claims about the present MVP; its constraints are documented in Section 3.

## 2. System Architecture

BlindSight is organized around three pillars: the application experience, confidential inference, and programmable settlement.

### Pillar A: Next.js Frontend — Data Vault & Research Console

The Next.js App Router frontend provides two connected workflows:

- **Data Provider Vault:** accepts supported text datasets, validates and indexes them through the API on upload, presents a local encryption visualizer, and tracks whether a dataset is ready for a query.
- **Research Console:** accepts a natural-language prompt, displays the simulated buyer escrow balance, submits the request, and renders the insight, attestation status, and settlement result.
- **Autonomous Agent Bidding:** requests a metadata-based provider valuation from `/api/agent-bid`, displays the proposed USDC quote and mock rationale, and requires provider acceptance before the research query can run.
- **Walletless UX via Account Abstraction:** To provide a seamless Web2-like experience, the product intentionally avoids requiring users to connect a traditional wallet. In the production architecture, the autonomous AI agent manages escrow and coordinates cross-chain payouts in the background using NEAR Chain Signatures and Intents. The current MVP simulates this flow locally; it does not manage escrow or execute blockchain transactions.

The client coordinates the demo lifecycle: provider upload, buyer funding, query execution, and payout feedback. In the current implementation these states are held in browser memory; the deposit and settlement are not wallet-backed transactions.

### Pillar B: NEAR AI Cloud Gateway — Confidential Inference

The server-side `POST /api/query-tee` route prepares and validates dataset structure on upload, builds a column index, then stores the prepared dataset under an opaque ID in a bounded process-local cache. Queries reference that ID so a warm instance can reuse its parsed representation. For cold-instance recovery the page also supplies the dataset, which the route reparses only if the cache entry is unavailable. The route then uses the OpenAI-compatible NEAR AI Cloud endpoint and open-weight model `zai-org/GLM-5.1-FP8`, enforces request limits, and returns the model insight. The gateway is configured with server-side `NEAR_AI_API_KEY`.

The production target is inference inside an attested Trusted Execution Environment (TEE), such as an Intel TDX-backed environment. The provider would encrypt the dataset to the TEE's public key before it leaves the client. The TEE would decrypt and process it within the protected execution boundary, returning only the approved result and verifiable attestation evidence.

The separate `POST /api/agent-bid` route validates the uploaded dataset structure and derives its row count server-side; it does not trust a client-provided count. The current mock agent calculates a quote at $0.05 per row and returns a short deterministic justification. The provider must accept this quote before the query is enabled; the accepted amount is then passed to the payout helper.

Both API routes add `attestation_proof: "AMD-SEV-SNP-Verified-v1.2"` to their JSON response and an `X-TEE-Attestation-Proof` header. This metadata is a fixed demo declaration only; it is not cryptographic or hardware-backed attestation.

### Pillar C: NEAR Chain Signatures / Intents — Provider Settlement

The settlement design uses NEAR Chain Signatures and Intents, with the Defuse SDK, to coordinate autonomous USDC payouts to data providers. A verified query result and provider-defined reward would inform a withdrawal request; the intended production flow is to authorize and execute that request through the appropriate NEAR and cross-chain settlement infrastructure.

In the current MVP, `lib/executeSettlement.ts` validates the mock attestation token and payout parameters, then returns a synthetic transaction hash. The Defuse types are used to shape-check a withdrawal request, but the SDK does not submit a transaction. No buyer deposit, escrow, cross-chain transfer, or provider payout occurs on-chain in this build.

### Request Flow

```text
Provider browser        BlindSight API        NEAR AI Cloud / TEE       Settlement
       |                       |                       |                     |
       |-- dataset + query ---->|                       |                     |
       |                       |-- inference request -->|                     |
       |                       |<-- insight + evidence-|                     |
       |<-- result + status ----|                       |                     |
       |---------------------------------------------------- payout request -->|
       |<----------------------------------------------- settlement result ---|
```

The diagram describes the intended product flow. In the MVP, encryption, attestation, buyer funding, and settlement are simulations; specifically, the API receives the original dataset string for inference.

## 3. Hackathon MVP Constraints & Mock Declarations

BlindSight is a 14-day sprint MVP. The following declarations are part of the architecture and should be considered when evaluating its current security and transaction guarantees.

- **Client-Side Encryption:** The UI simulates AES-256 encryption visually by streaming random alphanumeric characters. This preview is not an encryption transform and does not encrypt the uploaded file. In production, the payload is encrypted client-side using the TEE's public key before transmission. Currently, the MVP routes the dataset to the API to demonstrate the inference loop; the original dataset is sent to the configured model gateway.
- **Hardware Attestation:** The Intel TDX / NVIDIA hardware attestation token is mocked in the current MVP build to simulate the verification flow. The API returns a fixed mock token, and the UI badge is driven by the presence of that token. It is not hardware evidence or cryptographic verification.
- **Settlement & Escrow:** The buyer USDC deposit and the Defuse SDK cross-chain automated payouts are mocked to demonstrate the capital-flow architecture without requiring live mainnet liquidity. The balance is local UI state; the payout helper constructs and type-checks a request-shaped object but does not invoke Defuse or move funds. The displayed transaction hash is synthetic.
- **Dataset Quality & Empty-Store Fallback:** CSV/TSV uploads require a header row and consistently sized data rows; JSON must contain structured rows or objects, and text files must contain non-empty lines. Malformed populated data is rejected with `Dataset rejected: File structure does not meet quality standards.` Missing or structurally empty input uses a small pre-seeded synthetic DeFi liquidity dataset for demo continuity.
- **Inference Probing Defense:** The query route keeps a bounded, process-local history keyed by requester and dataset fingerprint. More than five highly specific queries overlapping the same terms in a 15-minute window receive a 429 rate-limit response asking the user to generalize. This is a best-effort MVP heuristic, not a distributed or privacy-proof differential-privacy system; serverless instance restarts and independent instances do not share the history.
- **Prepared Dataset Cache:** Parsed rows and column indexes are cached in process memory with a bounded entry count and TTL. This reduces repeated parsing on a warm instance. It is not durable or shared across serverless instances; the raw payload is retained in the request for cache-miss recovery.

These boundaries are explicit so judges can distinguish the product architecture being demonstrated from production-grade cryptography, attested execution, wallet custody, and live settlement.

## Current MVP Components

| Component | Current responsibility | Current status |
| --- | --- | --- |
| `app/page.tsx` | Provider upload, encryption visualizer, buyer balance, query UI, result and attestation display | Interactive client-side demo |
| `app/api/query-tee/route.ts` | Dataset/query validation and OpenAI-compatible inference request | Calls NEAR AI Cloud when `NEAR_AI_API_KEY` is configured; returns mock attestation |
| `app/api/agent-bid/route.ts` | Metadata-based row pricing and mock agent rationale | Returns a deterministic $0.05-per-row quote |
| `lib/executeSettlement.ts` | Attestation-prefix check, USDC amount conversion, withdrawal request shape | Mock only; does not execute a transfer |

## Productionization Priorities

1. Implement client-side authenticated encryption to the selected TEE's published public key, and transmit only the ciphertext plus required metadata.
2. Verify hardware attestation cryptographically against a trusted issuer and bind the evidence to the inference request and result.
3. Integrate wallet authorization, escrow accounting, and actual Defuse/NEAR Intents settlement; expose transaction status from chain receipts rather than synthetic hashes.
4. Add protocol-level consent, query policy, auditability, key rotation, replay protection, and failure/refund handling for production deployments.