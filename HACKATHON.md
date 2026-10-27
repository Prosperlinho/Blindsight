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

- **Data Provider Vault:** accepts supported text datasets, presents a local encryption visualizer, and tracks whether a dataset is ready for a query.
- **Research Console:** accepts a natural-language prompt, displays the simulated buyer escrow balance, submits the request, and renders the insight, attestation status, and settlement result.
- **Autonomous Agent Bidding:** requests a metadata-based provider valuation from `/api/agent-bid`, displays the proposed USDC quote and mock rationale, and requires provider acceptance before the research query can run.

The client coordinates the demo lifecycle: provider upload, buyer funding, query execution, and payout feedback. In the current implementation these states are held in browser memory; the deposit and settlement are not wallet-backed transactions.

### Pillar B: NEAR AI Cloud Gateway — Confidential Inference

The server-side `POST /api/query-tee` route uses the OpenAI-compatible NEAR AI Cloud endpoint and the open-weight model `zai-org/GLM-5.1-FP8`. It validates the dataset and query, applies request size limits, and returns the model insight to the frontend. The gateway is configured with the server-side `NEAR_AI_API_KEY` environment variable.

The production target is inference inside an attested Trusted Execution Environment (TEE), such as an Intel TDX-backed environment. The provider would encrypt the dataset to the TEE's public key before it leaves the client. The TEE would decrypt and process it within the protected execution boundary, returning only the approved result and verifiable attestation evidence.

The separate `POST /api/agent-bid` route accepts file count, byte size, and estimated row count. The current mock agent calculates a quote at $0.05 per row and returns a short deterministic justification. The provider must accept this quote before the query is enabled; the accepted amount is then passed to the payout helper.

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