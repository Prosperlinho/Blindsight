# BlindSight

> Ask a question. Pay for the answer. Never hand over the dataset.

BlindSight is a confidential data marketplace on NEAR testnet. Publishers list datasets in sealed
vaults. Buyers pay in NEAR to ask a question and get an AI answer, never the raw records. The AI
runs in an attested hardware enclave on NEAR AI Cloud. BlindSight verifies that enclave on every
question, encrypts the question to it, and shows a signed privacy receipt with the answer.

**Live app:** [https://blindsight-zeta.vercel.app/](https://blindsight-zeta.vercel.app/)

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
| Encrypted question | The prompt is sent with Oblivious HTTP (RFC 9458), encrypted to a key signed by the attested gateway, so it is unreadable outside the enclave. |
| Signed answer | The enclave's ed25519 signature over the exact request and response bytes is verified against the attested key. |
| Privacy receipt | Each answer shows **Verified private answer** with expandable details. |
| Publishing | A one-time 0.05 NEAR fee. The dataset is encrypted with AES-256-GCM into a private Supabase bucket; only metadata is listed. |
| Unpublishing | Only the publisher can remove a vault, proven with a fresh NEP-413 wallet signature that is verified on chain. |
| Sample datasets | Three synthetic datasets in server-only code. The browser only sends a `vaultId`. |
| Anti-probing | Best effort: in-memory query history and pattern checks per server instance. |
| Replay protection | Best effort for query payments (in-memory, per instance). Publishing fees are single-use, enforced by a unique database column. |

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

### Timing

The first question on a fresh server instance takes about 25–35 seconds, because Intel quote
verification takes around 20 of them. Attestations are cached for 10 minutes, after which answers
take about 8–12 seconds. If enclave verification can't finish in time, the buyer still gets the
answer, and the receipt shows only the checks that passed.

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
| `NEXT_PUBLIC_BLINDSIGHT_TREASURY_ACCOUNT` | Optional | Treasury for sample-vault payments. Defaults to `blindsight-ceeaa6612a.testnet`. |
| `BLINDSIGHT_TREASURY_ACCOUNT` | Optional | Server-side override for the same treasury. |
| `NEXT_PUBLIC_BLINDSIGHT_PLATFORM_TREASURY` | Optional | Receives platform fees. Defaults to the treasury. |
| `NEXT_PUBLIC_BLINDSIGHT_QUERY_FEE_NEAR` | Optional | Per-question fee. Default `0.01`; `0` disables it. |
| `NEXT_PUBLIC_BLINDSIGHT_PUBLISH_FEE_NEAR` | Optional | One-time publishing fee. Default `0.05`; `0` disables it. |
| `SUPABASE_URL` | For publishing | Supabase project URL. |
| `SUPABASE_ANON_KEY` | For publishing | Used only server-side. |
| `PUBLISHED_VAULT_ENCRYPTION_KEY` | For publishing | Stable 32-byte hex key for AES-256-GCM. Back it up: changing it makes existing uploads unreadable. |

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
  api/
    query-tee/route.ts       Verify payments, load dataset, private inference
    vaults/route.ts          List, publish (fee-verified) and unpublish (signature-verified)
    vault/parse/route.ts     Text and PDF extraction
    verify-payment/route.ts  Standalone transfer check (optional for agents)
components/
  QueryVault.tsx             Vault explorer, query console, publishing
  PrivacyReceipt.tsx         "Verified private answer" receipt
  LandingIntro.tsx           Landing content
  ConnectModal.tsx, WalletProvider.tsx
lib/
  privateInference.ts        TDX attestation, OHTTP/HPKE, enclave signature checks
  paymentVerification.ts     On-chain transfer verification
  platformFees.ts            Query and publishing fees
  near-transfers.ts          Wallet signing, batched transfers
  publishedVaults.ts         Supabase metadata and encrypted storage
  vaultOwnership.ts, verifyVaultOwner.ts   NEP-413 unpublish proofs
  demoVaults.ts, demoVaultDatasets.ts      Sample vaults (datasets server-only)
  datasetQuality.ts          Dataset preparation and cache
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

Failures return `{ success: false, error, code }` with a 4xx or 5xx status.

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

- **BlindSight's server is not an enclave.** It decrypts published datasets in memory to build
  the prompt. The path from BlindSight to the model is attested, encrypted and signed, but
  publishers must trust BlindSight's server with their data. Moving this step into a TEE is the
  next milestone.
- **No escrow contract.** Transfers settle directly to recipients on testnet.
- **Replay protection and anti-probing are per instance and in memory**, and reset on cold
  starts.
- **Anti-probing is heuristic.** It raises the cost of reconstructing a dataset but doesn't
  prevent it.

Use synthetic or non-sensitive data. Don't upload real personal, medical, financial or
confidential data.
