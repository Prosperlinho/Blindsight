# BlindSight

> Ask a question. Pay for the answer. Never hand over the dataset.

BlindSight is a confidential data marketplace on NEAR testnet. Publishers list datasets in sealed
vaults. Buyers pay in NEAR to ask a question and get an AI answer, never the raw records. The AI
runs in an attested hardware enclave on NEAR AI Cloud. BlindSight verifies that enclave on every
question, encrypts the question to it, and shows a signed privacy receipt with the answer.

**Live app:** [https://blindsight-zeta.vercel.app/](https://blindsight-zeta.vercel.app/) ·
[Docs](https://blindsight-zeta.vercel.app/docs) ·
[Privacy policy](https://blindsight-zeta.vercel.app/privacy)

Hackathon write-up (Track 3, Privacy & Private AI): [HACKATHON.md](HACKATHON.md).

### Built at NEAR HACKATHON

- **Track:** 03, Privacy & Private AI. Built on NEAR AI Cloud private inference with TEE
  verification.
- **Built in the hackathon window.** The repository was created on 2026-10-26, after the
  announcement on 2026-10-19, so there is no pre-hackathon baseline: every commit is hackathon work.
- **Network:** NEAR testnet.
- **Hosted demo:** live at the URL above and kept online through judging.
- **Third-party code:** open-source libraries only, from `package.json`:
  - Next.js, React, `lucide-react`
  - NEAR Wallet Selector and `near-api-js`
  - `@phala/dcap-qvl` (Intel TDX quote verification)
  - `openai` (an OpenAI-compatible client for NEAR AI Cloud)
  - `pdf-parse`
  - HPKE, OHTTP and Binary HTTP are implemented directly on Node's built-in crypto
- **AI assistance:** parts of the code and docs were written with AI coding assistants. The app
  started from the Create Next App template.
- **License:** [MIT](LICENSE).

---

## What's real

| Area | What actually happens |
| --- | --- |
| Wallet connection | NEAR Wallet Selector with MyNearWallet and Meteor on `testnet`. |
| Account balance | Read from the public FastNear testnet RPC (`view_account`). |
| Query payment | One approval, two native NEAR transfers: the vault price to the publisher's payout account (or the treasury for sample vaults), plus a 0.01 NEAR platform fee to the treasury. |
| Payment verification | The server fetches both finalized transactions from `https://rpc.testnet.fastnear.com`. It checks signer, receiver, amount, execution status and age before inference. |
| Private inference | `deepseek/deepseek-v3.2` on NEAR AI Cloud, running in Intel TDX with NVIDIA GPU attestation. |
| Enclave verification | On every question BlindSight checks the gateway and model TDX quotes against Intel's certificate chain, bound to a fresh nonce. |
| Encrypted question | The prompt is sent with Oblivious HTTP (RFC 9458), encrypted to a key signed by the attested gateway, so it is unreadable outside the enclave. There is no plain-HTTPS fallback: if the enclave can't be verified or OHTTP fails, the prompt is not sent and the payment stays retryable. |
| Signed answer | The enclave's ed25519 signature over the exact request and response bytes is verified against the attested key. |
| Privacy receipt | Each answer shows **Verified private answer** with expandable details. |
| Answer provenance receipt | Each successful answer includes a copyable receipt linking the model response fingerprints, vault snapshot, dataset record/field counts, and verified NEAR payment. The receipt is an integrity record, not a proof that an interpretation is correct. |
| Publishing | Upload CSV, TXT or Markdown files (up to 500 KB combined) and pay a one-time 0.05 NEAR fee. The dataset is encrypted with AES-256-GCM into a private Supabase bucket; only metadata is listed. |
| Unpublishing | Only the publisher can remove a vault, proven with a fresh NEP-413 wallet signature that is verified on chain. |
| Sample datasets | Three synthetic datasets in server-only code. The browser only sends a `vaultId`. |
| Aggregate-only answers | Questions asking for raw records are refused before inference, the model is instructed to answer with aggregates, and answers that reproduce records, quote long passages, come back as tables or contain personal identifiers are withheld. A refused or withheld answer doesn't use up the payment. |
| Anti-probing | Query history and pattern checks per account and per IP. Only keyed hashes of each question and its words are kept, never the question text. Shared across instances through Upstash Redis when configured. |
| Replay protection | Used payments are claimed atomically in Upstash Redis (in-memory fallback without it), and each payment is tied to one question. Publishing fees are single-use, enforced by a unique database column. |
| Enclave mode | Built, and on when `ENCLAVE_URL` is set (see [enclave/README.md](enclave/README.md)). Datasets are sealed in the publisher's browser to a BlindSight enclave on Phala Cloud (Intel TDX), whose attestation, code hash and response signatures the server verifies. The web server never sees dataset plaintext. |

There are no mock balances, fake transaction hashes or fabricated attestation tokens. If testnet
NEAR is needed, use the [NEAR testnet faucet](https://near-faucet.io/).

---

## How a paid question works

```text
Buyer browser                   BlindSight server                    External
─────────────                   ─────────────────                    ────────
1. Pick a vault, ask
2. Wallet approves price +
   platform fee transfers ─────────────────────────────────────────► NEAR testnet
3. POST /api/query-tee ───────► verify both transfers via RPC ──────► NEAR RPC
                                load dataset (decrypt if published)
                                anti-probing checks
                                attest enclave (TDX quotes, nonce) ─► NEAR AI attestation
                                OHTTP-encrypt prompt ───────────────► NEAR AI enclave
                                verify enclave signature ◄────────── DeepSeek V3.2
4. Answer + payment + receipt ◄─
```

The server does not trust the client. For each transfer it checks:

- the transaction is finalized and executed successfully;
- the signer is the claimed payer;
- the receiver is the vault's payout account, or the platform treasury for the fee;
- the deposit covers the vault price or fee;
- the transaction is less than two hours old;
- the hash has not already been used on this server instance.

If inference fails after the payment is verified, the same payment can be retried without paying
again.

Successful answers include an expandable **Evidence & answer receipt**. It shows the vault
snapshot, the dataset coverage used for the answer, model and timestamp, the NEAR payment link,
and fingerprints for the model input, model response, answer text, and receipt. Copy the receipt
JSON to keep a local record. The raw dataset and question are not included; fingerprints are
integrity checks, not anonymity guarantees, and the receipt does not independently prove that the
interpretation is correct.

### Timing

The first question on a fresh server instance takes about 25–35 seconds, because Intel quote
verification takes around 20 of them. Attestations are cached for 10 minutes, after which answers
take about 8–12 seconds. If the enclave can't be verified in time, the question is not sent and the
buyer can retry with the same payment once verification completes in the background. If only the
answer signature can't be checked in time, the buyer still gets the answer, and the receipt shows
only the checks that passed.

---

## Demo (about 3 minutes)

1. Open [https://blindsight-zeta.vercel.app/](https://blindsight-zeta.vercel.app/) and enter the
   marketplace.
2. Click **Connect Wallet** and choose a NEAR testnet wallet. Fund it from the
   [faucet](https://near-faucet.io/) if needed.
3. Pick a sample vault:
   - **Medical Research Cohort 2026**, 0.1 NEAR
   - **Q3 Financial & Market Demand**, 0.15 NEAR
   - **Solidity Security Audit Report**, 0.2 NEAR

   Each question also adds the 0.01 NEAR platform fee, shown in the price breakdown.
4. Ask a question, for example *Which segment has the highest year-over-year growth?*
5. Approve the transfers in the wallet. The app moves through payment confirmation to the answer.
6. Under the answer, open **Details** on **Verified private answer**. It shows the Intel TDX
   status, the model and GPU check, that the question was encrypted to the enclave, the enclave's
   signing key, and fingerprints of the question and answer.
7. The transaction links open on NEARBlocks.

To publish your own vault, use the **Publish** tab: upload a file, set a price and payout account,
and pay the publishing fee. Your vaults show a remove option that only your wallet can authorize.

---

## Local setup

### Prerequisites

- Node.js 20.9+
- A NEAR testnet wallet such as [MyNearWallet](https://testnet.mynearwallet.com/) or Meteor

### Install and run

```bash
git clone https://github.com/Prosperlinho/Blindsight.git
cd Blindsight
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEAR_AI_API_KEY` | **Yes** | Server-side key for NEAR AI Cloud. |
| `NEXT_PUBLIC_BLINDSIGHT_TREASURY_ACCOUNT` | Optional | Treasury for sample-vault payments. Defaults to `blindsight.testnet`. |
| `BLINDSIGHT_TREASURY_ACCOUNT` | Optional | Server-side override for the same treasury. |
| `NEXT_PUBLIC_BLINDSIGHT_PLATFORM_TREASURY` | Optional | Receives platform fees. Defaults to the treasury. |
| `NEXT_PUBLIC_BLINDSIGHT_QUERY_FEE_NEAR` | Optional | Per-question fee. Default `0.01`; `0` disables it. |
| `NEXT_PUBLIC_BLINDSIGHT_PUBLISH_FEE_NEAR` | Optional | One-time publishing fee. Default `0.05`; `0` disables it. |
| `SUPABASE_URL` | For publishing | Supabase project URL. |
| `SUPABASE_ANON_KEY` | For publishing | Used only server-side. |
| `PUBLISHED_VAULT_ENCRYPTION_KEY` | Direct mode publishing | Stable 32-byte hex key for AES-256-GCM. Back it up: changing it makes existing uploads unreadable. Not needed once all vaults are in the enclave. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Recommended | Upstash Redis for shared replay protection and rate limits. Added automatically by Vercel's Upstash integration. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work. |
| `ENCLAVE_URL` | Enclave mode | URL of the BlindSight enclave on Phala Cloud. Setting it turns enclave mode on. |
| `ENCLAVE_API_TOKEN` | Enclave mode | Shared secret for calls to the enclave (32+ characters). |
| `ENCLAVE_COMPOSE_HASH` | Enclave mode | Pinned code hash of the enclave build. The server refuses any other build. |
| `ENCLAVE_APP_ID` | Optional | Also pin the Phala app ID. |

To enable publishing, run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor.
It creates the `vaults` table, the private `vault-datasets` bucket and their policies. It is safe
to re-run after upgrades. Generate the encryption key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Without Supabase, sample vaults still work. Without `NEAR_AI_API_KEY`, payments still verify, but
questions return `INFERENCE_NOT_CONFIGURED`. The payment stays retryable once the key is added.

### Checks

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

---

## Project structure

```text
app/
  page.tsx                   Landing page
  marketplace/page.tsx       Marketplace shell, wallet state, activity
  docs/page.tsx              User and API documentation (/docs)
  privacy/page.tsx           Privacy policy (/privacy)
  api/
    query-tee/route.ts       Verify payments, load dataset, private inference
    vaults/route.ts          List, publish (fee-verified) and unpublish (signature-verified)
    enclave/route.ts         Verified enclave identity and raw attestation (public)
    enclave/validate/route.ts  Check a sealed dataset inside the enclave before paying
    vault/parse/route.ts     Text and PDF extraction
    verify-payment/route.ts  Standalone transfer check (optional for agents)
components/
  QueryVault.tsx             Vault explorer, query console, publishing
  PrivacyReceipt.tsx         "Verified private answer" receipt
  LandingIntro.tsx           Landing content
  InfoPage.tsx, SiteFooter.tsx   Docs/privacy page shell and shared footer
  ConnectModal.tsx, WalletProvider.tsx
lib/
  privateInference.ts        NEAR AI TDX attestation, OHTTP/HPKE, enclave signature checks
  privateAnswer.ts           Prompt, retries and output guard (shared with the enclave)
  answerGuard.ts             Aggregate-only checks for questions and answers
  sharedStore.ts             Upstash Redis (or memory) for payments and rate limits
  enclaveProtocol.ts         Sealed-dataset format, attestation binding, response signatures
  enclaveClient.ts           Verifies the BlindSight enclave and its signed responses
  sealBrowser.ts             Seals datasets to the enclave in the browser (WebCrypto)
  paymentVerification.ts     On-chain transfer verification
  platformFees.ts            Query and publishing fees
  near-transfers.ts          Wallet signing, batched transfers
  publishedVaults.ts         Supabase metadata and encrypted storage
  vaultOwnership.ts, verifyVaultOwner.ts   NEP-413 unpublish proofs
  demoVaults.ts, demoVaultDatasets.ts      Sample vaults (datasets server-only)
  datasetQuality.ts          Dataset preparation and cache
enclave/                     BlindSight enclave service for Phala Cloud (Dockerfile, compose, guide)
scripts/migrate-vaults-to-enclave.mjs   Re-seals pre-enclave vaults to the enclave
supabase/schema.sql          Tables, bucket, policies
```

---

## API

### `POST /api/query-tee`

```json
{
  "query": "Which segment grew fastest?",
  "txHash": "<vault price transfer>",
  "feeTxHash": "<platform fee transfer>",
  "payerAccountId": "buyer.testnet",
  "vaultId": "q3-financial-market-demand"
}
```

`feeTxHash` is required when the query fee is enabled. A successful response contains:

- `insight`
- `receiptId` (the price transaction hash)
- `payment`, the verified transfer details
- `privacy`, the receipt: `attested`, `encryptedToEnclave`, `responseSigned`, the TCB statuses,
  the GPU verdict, the attestation nonce, the signer key, and the request and response hashes
- `enclave` (enclave mode only): the verified code hash, app ID, TCB status and signing key of the
  BlindSight enclave that opened the dataset

Failures return `{ success: false, error, code }` with a 4xx or 5xx status.
`QUESTION_NOT_AGGREGATE` and `ANSWER_WITHHELD` mean the aggregate-only checks applied; the payment
can be reused with a different question.

### `GET /api/vaults` · `POST /api/vaults` · `DELETE /api/vaults`

- `GET` lists published vault metadata.
- `POST` publishes a vault and requires a verified publishing-fee transaction.
- `DELETE` requires a NEP-413 signature from the publisher.

### Agents

Any agent with a NEAR testnet key can use the same flow without a browser:

1. Transfer the vault price to its payout account and the fee to the platform treasury.
2. POST both hashes, the payer account, the `vaultId` and the question to `/api/query-tee`.
3. Read `privacy` in the response to confirm the answer came from a verified enclave.

---

## Security and limitations

- **Without enclave mode, BlindSight's server is not an enclave.** It decrypts published
  datasets in memory to build the prompt. The path to the model is attested, encrypted and
  signed, but publishers must trust BlindSight's server with their data.
- **With enclave mode**, publishers trust Phala's OS image and key service instead, and the app
  owner's control over upgrades. The server checks the enclave's TDX quote, its RTMR3 log and a
  pinned code hash, but not MRTD/RTMR0-2 against Phala's OS measurements. Raw evidence is at
  `/api/enclave` for independent checks. Questions reach the enclave over TLS that ends in
  Phala's gateway TEE.
- **No escrow contract.** Transfers settle directly to recipients on testnet.
- **Shared state needs Redis.** Without Upstash configured, replay protection and anti-probing
  are per instance and in memory, and reset on cold starts.
- **Aggregate-only checks and anti-probing are heuristics.** They stop bulk copying and obvious
  leaks and raise the cost of reconstruction, but many narrow aggregate questions can still
  reveal individual records.

Use synthetic or non-sensitive data. Don't upload real personal, medical, financial or
confidential data.

See the [privacy policy](https://blindsight-zeta.vercel.app/privacy) for what data the app
handles and how long it is kept.

---

## Contact

Questions, privacy requests or bug reports: email
[prosperlinho@gmail.com](mailto:prosperlinho@gmail.com) or open an
[issue on GitHub](https://github.com/Prosperlinho/Blindsight/issues).
