# BlindSight Architecture and Codebase Report

**Snapshot:** 2026-10-27

## Project Structure

The current source-level tree, including the autonomous agent bidding feature and judge-facing documentation, is:

```text
.
|-- .env.local                  # Local environment values; contents omitted
|-- .gitignore
|-- AGENTS.md
|-- ARCHITECTURE_REPORT.md
|-- HACKATHON.md
|-- README.md
|-- app/
|   |-- api/
|   |   |-- agent-bid/
|   |   |   `-- route.ts
|   |   `-- query-tee/
|   |       `-- route.ts
|   |-- favicon.ico
|   |-- globals.css
|   |-- layout.tsx
|   `-- page.tsx
|-- eslint.config.mjs
|-- lib/
|   |-- attestedResponse.ts
|   |-- datasetQuality.ts
|   `-- executeSettlement.ts
|-- next-env.d.ts
|-- next.config.ts
|-- package-lock.json
|-- package.json
|-- public/
|   |-- file.svg
|   |-- globe.svg
|   |-- next.svg
|   `-- vercel.svg
|-- tsconfig.json
`-- tsconfig.tsbuildinfo
```

The workspace also contains `.git/`, `.next/`, and `node_modules/`; these are repository metadata, generated Next.js output, and installed dependencies rather than application source.

## Architecture

BlindSight is a Next.js App Router application. The interactive experience is a single client-rendered page in [`app/page.tsx`](app/page.tsx). That page owns file intake, the encryption visualizer, the buyer's simulated escrow balance, query submission, and result/attestation rendering. Its server-side inference boundary is the `POST /api/query-tee` route in [`app/api/query-tee/route.ts`](app/api/query-tee/route.ts). The page delegates provider payout validation and mock settlement construction to [`lib/executeSettlement.ts`](lib/executeSettlement.ts).

`app/layout.tsx` provides the Geist font variables and document metadata. `app/globals.css` imports Tailwind CSS and sets the dark palette. `next.config.ts` enables `cacheComponents`, `partialPrefetching`, Turbopack CSS loading, and experimental `agentFeedback`. The package uses Next.js 16.4.3, React 19.3.0, Tailwind CSS 4, the OpenAI SDK, and Defuse Intents SDK types/dependency.

```mermaid
flowchart LR
  U[Browser / app/page.tsx] -->|POST action prepare + dataset| R[/api/query-tee/]
  R -->|validated rows, index + dataset ID| U
  U -->|POST dataset + file metadata| B[/api/agent-bid/]
  B -->|mock USDC bid + justification| U
  U -->|POST dataset ID + query| R
  R -->|OpenAI-compatible request| N[NEAR AI Cloud gateway]
  N -->|insight| R
  R -->|insight + hard-coded mock attestation token| U
  U -->|validate token + build mock withdrawal request| S[lib/executeSettlement.ts]
  S -->|synthetic transaction hash| U
```

## `app/page.tsx`

### Client-Side Encryption Visualizer

The page stores uploaded files as `VaultFile` objects containing each filename, size, and text content. File contents are read with `file.text()`; accepted files are CSV, JSON, TXT, or TSV and must be under 1 MB each.

`handleEncryptPayload` starts a two-second animation. Every 40 ms, `randomCiphertextChunk` obtains random bytes with `window.crypto.getRandomValues`, maps them to alphanumeric characters, and appends the result to a preview capped at 2,400 characters. Only after the timer completes does the page set `vaultQueued` to true and render the green “Payload Encrypted (AES-256). Ready for TEE Transmission.” state. This is a random-character visualizer, **not AES-256 encryption**: it does not transform or encrypt the uploaded text.

After upload, the page sends the joined file text once to the query route's `action: "prepare"` handler. It stores the opaque `datasetId` returned with validated row and column counts. Subsequent queries include the ID and raw data only as a cache-miss recovery field; a warm process reuses the parsed/indexed value. The request also includes `ciphertextPreview` and `encryptionMode: "mock-aes-256"`, which remain visual metadata and are not used to encrypt data. See [`app/page.tsx`](app/page.tsx#L77) and [`app/page.tsx`](app/page.tsx#L205).

### Buyer Deposit and Escrow Balance

`buyerBalance` begins at `0`; `isDepositing` controls the deposit loading state. `handleDeposit` waits 700 ms and sets the balance to 50 USDC. This is local UI state and a simulated transaction, not a wallet connection or token transfer. The button becomes disabled at 50 USDC.

The query handler and submit button both require an accepted bid and at least 10 USDC. After the API response contains both an insight and an attestation token, the page subtracts 10 USDC before invoking `executeDataPayout` with the accepted bid amount. Since the decrement occurs before payout completes, a later payout-helper error does not restore the balance. See [`app/page.tsx`](app/page.tsx#L47) and [`app/page.tsx`](app/page.tsx#L120).

### Autonomous Agent Bidding

Once the encryption preview is ready, the provider can request a valuation. The page posts the dataset and file metadata to `/api/agent-bid`; that route parses and validates the data and derives the row count server-side. It returns a deterministic quote at $0.05 per row with a generated explanation. The quote is mock pricing, not an external LLM result. The query stays disabled until the provider accepts the returned quote, and the accepted amount is used as the payout amount. Files cannot be changed while valuation is in flight, preventing a quote for stale metadata from being accepted.

### TEE Query and Attestation Badge

`handleSubmit` requires a non-empty prompt, attached files, a prepared dataset ID, completed local-preview step, an accepted bid, at least 10 USDC, and no query already running. It POSTs the dataset ID, query, and mock ciphertext metadata to `/api/query-tee`. The route reuses its prepared cache when available, otherwise validates and rebuilds from the recovery payload. The page requires both `insight` and `attestationToken`, debits the buyer balance, and calls `executeDataPayout` with the accepted bid. On success it renders the insight, token, synthetic settlement hash, and increments the run counter. Errors are shown in the request-failed alert.

The “Mock TEE attestation” panel is driven by whether `attestationToken` is non-empty. When present, it displays “Intel TDX / NVIDIA Hardware Verification: PASSED”; the adjacent copy correctly qualifies this as a mock prefix and says it is not hardware proof. The API currently returns a fixed mock token, so this badge is not a hardware verification. See [`app/page.tsx`](app/page.tsx#L120) and [`app/page.tsx`](app/page.tsx#L477).

## `app/api/query-tee/route.ts`

The route supports an upload-time `action: "prepare"` request and query requests. Preparation parses CSV/TSV headers and row widths, structured JSON, or non-empty TXT lines; it builds a row representation and per-column index and caches that prepared value under an opaque UUID for up to 30 minutes (maximum 100 entries per process). Missing or structurally empty input falls back to seeded DeFi liquidity data; malformed non-empty data returns the quality error. Query requests require a non-empty prompt and enforce a 2,000-character limit. If a prepared ID is absent from the process cache, the route reparses the recovery dataset when supplied; an expired ID without recovery data returns 409. Oversized serialized inference data is truncated to the configured cap. If `NEAR_AI_API_KEY` is absent, the route returns 503.

The route tracks recent query terms in bounded process-local memory, keyed by requester and dataset fingerprint. More than five highly specific queries overlapping the same terms within a 15-minute window receive a 429 reconstruction warning. This is a best-effort heuristic, not differential privacy, and separate serverless instances do not share this history. The route creates an OpenAI SDK client with `baseURL: "https://cloud-api.near.ai/v1"` and calls chat completions using model `zai-org/GLM-5.1-FP8`. A successful response returns the model insight and hard-coded token `mock_intel_tdx_token_8xJp2`. Timeout fallback and API error/success responses include `attestation_proof: "AMD-SEV-SNP-Verified-v1.2"` and an `X-TEE-Attestation-Proof` header; both are simulated metadata, not cryptographic or hardware evidence. See [`app/api/query-tee/route.ts`](app/api/query-tee/route.ts#L3) and [`app/api/query-tee/route.ts`](app/api/query-tee/route.ts#L32).

## `lib/executeSettlement.ts`

`executeDataPayout(dataProviderAddress, amountInUSDC, attestationToken)` performs these steps:

1. Checks that the token begins with `mock_intel_tdx`; otherwise throws “TEE attestation token was not accepted.” This is a string-prefix check, not cryptographic token verification.
2. Trims and validates the destination address as non-empty and no longer than 128 characters.
3. Parses the USDC amount using a decimal-only expression with no more than six fractional digits, converts it to six-decimal base units using `BigInt`, and rejects values at or below zero.
4. Constructs `WithdrawalParams` for `nep141:usdc.omft.near`, the base-unit amount, destination, and `feeInclusive: true`. It wraps this in a `ProcessWithdrawalArgs`-shaped object.
5. Does **not** call the Defuse SDK to submit a withdrawal. The constructed SDK request is explicitly discarded with `void sdkRequest`. The helper instead returns status `SETTLED` and a synthetic `mock-near-intent-<UUID>` transaction hash.

Consequently, Defuse is currently used for TypeScript parameter types and request-shape checking, not for an actual on-chain payout. The success UI also labels the hash as synthetic and states that no funds moved. See [`lib/executeSettlement.ts`](lib/executeSettlement.ts#L1) and [`lib/executeSettlement.ts`](lib/executeSettlement.ts#L23).

## `HACKATHON.md`

The root `HACKATHON.md` describes BlindSight's NEAR Hackathon Track 3 vision, the frontend / NEAR AI Cloud / NEAR settlement architecture, and the 14-day MVP constraints. It declares the encryption visualizer, attestation, buyer escrow, and payouts as mocks. It now also documents the autonomous agent bidding route and its fixed $0.05-per-row mock quote. The root `README.md` remains the standard create-next-app starter README.

## Requirements-Verification Notes

- **NEAR AI Cloud gateway/model:** Configured in the API route as requested; actual inference depends on the server-side `NEAR_AI_API_KEY`.
- **AES-256 encryption:** Not implemented. The current client animation generates random alphanumeric preview characters and labels this as a mock.
- **Encrypted inference payload:** Not implemented. The route sends the original dataset string to the NEAR AI Cloud model and ignores the preview fields.
- **Attestation:** Mock only. The API returns a fixed token and the client presents a corresponding mock badge.
- **USDC buyer funding:** Simulated local balance and delay only; no wallet transaction occurs.
- **Defuse payout:** Request parameters are constructed and typed, but the SDK is not invoked and no funds move.
- **Agent valuation:** `/api/agent-bid` derives a deterministic quote from row count at $0.05 per row; the justification is generated from metadata rather than an AI model.