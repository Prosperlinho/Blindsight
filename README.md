# BlindSight

> Ask a question. Pay for the answer. Never hand over the dataset.

BlindSight is a working hackathon prototype for a **paid private-data marketplace** on NEAR
testnet. A buyer connects a real NEAR wallet, selects a sample dataset, asks a natural-language
question, and signs a **real native NEAR transfer** for the query fee. The server verifies that
transfer against the public NEAR RPC before it calls an AI model, and the browser only renders the
answer after verification succeeds.

**Live app:** [https://blindsight-zeta.vercel.app/](https://blindsight-zeta.vercel.app/)

The dataset rows stay on the server. The browser receives vault metadata and a `vaultId`; it never
receives the sample records that are used for inference.

---

## Real vs prototype (honest disclosure)

BlindSight is deliberately explicit about which parts are real, because a judge should be able to
verify the payment and the answer independently.

| Area | Status | What actually happens |
| --- | --- | --- |
| Wallet connection | **Real** | NEAR Wallet Selector with MyNearWallet and Meteor on `testnet`. The connected account comes from Wallet Selector state. |
| Account balance | **Real** | Read from the public FastNear testnet RPC (`view_account`). There is no local ledger or minted balance. |
| Query payment | **Real** | The buyer signs a native NEAR transfer. Sample-vault fees go to the funded treasury; published-vault fees go to the publisher's configured payout account. |
| Payment verification | **Real** | The server fetches the finalized transaction from `https://rpc.testnet.fastnear.com` and checks signer, receiver, amount, execution status, and age. |
| Answer gating | **Real** | `/api/verify-payment` confirms the transfer, then `/api/query-tee` re-verifies the same hash before inference runs. |
| AI inference | **Real** | The server calls NEAR AI Cloud (`z-ai/glm-5.3`) with `NEAR_AI_API_KEY`. |
| Sample datasets | **Fictional data, real gating** | Three synthetic datasets live in server-only code. The browser only sends a `vaultId`. |
| Dataset lifecycle | **Prototype enclave (mimicked)** | The route drops its prepared dataset reference after inference. JavaScript cannot guarantee heap zeroing, and this is not hardware isolation. |
| TEE / enclave attestation | **Mimicked** | No hardware attestation exists and the UI does not display a fake attestation token. The interface labels the enclave as a server-side prototype. |
| Publisher payout | **Real for published vaults** | A published vault's full query fee is verified against and transferred to its configured payout account. Sample-vault fees go to the BlindSight treasury. |
| Shared vault storage | **Pinata IPFS** | Published metadata is pinned as public JSON and discovered through the shared Pinata account. Dataset content is encrypted before pinning; listing responses contain metadata only. |
| Anti-probing checks | **Best effort** | In-memory query history and pattern checks per server instance. Not a guarantee against dataset reconstruction. |
| Replay protection | **Best effort** | In-memory, per-instance map with a 24-hour TTL. It is not a network-wide nonce. |

There are no local balances, mock addresses, fake transaction hashes, or simulated payment-success
paths in the app. The only external prerequisite is testnet NEAR for the query fee; use the
[NEAR testnet faucet](https://near-faucet.io/) if your wallet is empty.

---

## NEAR tools used

- **NEAR testnet** — the settlement network.
- **`@near-wallet-selector/core`**, **`@near-wallet-selector/my-near-wallet`**,
  **`@near-wallet-selector/meteor-wallet`**, **`@near-wallet-selector/modal-ui`** — wallet
  connection and transaction signing.
- **`near-api-js`** — `parseNearAmount`, transfer actions, and the account surface used for signing.
- **Public NEAR testnet RPC** (`https://rpc.testnet.fastnear.com`) — balance reads and finalized
  transaction lookup.
- **NEAR AI Cloud** (`https://cloud-api.near.ai/v1`) — the inference provider.
- **NEARBlocks explorer** — transaction and account links surfaced in the UI.

Treasury account:

```text
blindsight-ceeaa6612a.testnet
```

It exists and is funded on testnet. The app never needs its private key, and no key is committed to
this repository.

---

## How a paid query works

```text
Buyer browser                     Next.js server                   NEAR testnet
─────────────                     ──────────────                   ────────────
1. Select a vault
2. Ask a question
3. Wallet signs native NEAR transfer ─────────────────────────────► treasury
4. POST /api/verify-payment ─────► RPC lookup + checks ────────────► RPC
                                   returns "payment confirmed"
5. POST /api/query-tee ─────────► re-verify payment
                                   resolve server-side dataset
                                   call NEAR AI Cloud
6. Answer + payment metadata ◄─── insight + verified transfer
```

What the UI shows at each stage:

1. **Connecting** — the wallet selector opens and the connected testnet account appears in the header.
2. **Paying** — the wallet is open and the transfer is awaiting approval.
3. **Payment confirmed** — the server has checked the finalized transfer; the amount, receiver, block
   height, and explorer link are displayed.
4. **Generating answer** — NEAR AI inference starts only after the payment is confirmed.
5. **Answer ready** — the insight appears with the same transaction hash and the inference model.
6. **Error** — the failure reason is displayed. If the payment was already confirmed, the answer can
   be retried with the same transfer instead of paying twice.

The server does not trust the client. It reads the transaction from RPC and validates:

- the transaction is finalized and executed successfully;
- the signer matches the claimed payer account;
- the receiver is the configured treasury;
- the native NEAR deposit covers the vault price;
- the transaction is younger than two hours;
- the hash has not already been consumed on this server instance.

---

## Judge demo (about 3 minutes)

The live app is preloaded with three sample vaults, so there is no setup beyond a funded testnet
wallet.

1. Open [https://blindsight-zeta.vercel.app/](https://blindsight-zeta.vercel.app/).
   **See:** the **Paid query console** with three sample vaults and a **Connect Wallet** button.
2. Click **Connect Wallet** and choose a NEAR testnet wallet.
   **See:** the wallet selector opens; after approval the header shows your `*.testnet` account and
   its real RPC balance.
3. If the account has no testnet NEAR, open the [NEAR testnet faucet](https://near-faucet.io/) and
   fund it. This is an external prerequisite; the app itself has no faucet.
4. Keep one of the preloaded sample vaults selected:
  - **Q3 Financial & Market Demand** — 0.5 NEAR
  - **Medical Research Cohort 2026** — 0.35 NEAR
  - **Solidity Security Audit Report** — 0.8 NEAR
   **See:** the vault card shows the price, publisher, row count, and the treasury fee recipient.
5. Ask a question, for example:
   - *Which segment has the highest year-over-year growth?*
   - *Summarize the most serious open security findings.*
   **See:** the query composer fills; the button reads **Pay … NEAR & ask**.
6. Click **Pay … NEAR & ask**.
   **See:** the wallet popup asks you to approve a real native NEAR transfer to
   `blindsight-ceeaa6612a.testnet`.
7. Approve the transfer in the wallet.
   **See:** the button advances through **Paying... → Confirming payment... → Payment confirmed →
   Generating answer...**.
8. Confirm the green **Payment confirmed on NEAR testnet** panel and open the NEARBlocks link.
   **See:** the finalized transaction on the explorer with the same hash the app displays.
9. The answer appears below.
   **See:** **Answer ready** with the insight, the verified payment amount and block height, the
   inference model, and the same transaction hash. The raw dataset is never returned.

Verification plus inference typically takes 5–30 seconds. The wallet also charges a small network
fee. If inference times out, the confirmed payment remains retryable without paying twice.

The **Vault Explorer** lets you switch between the samples and published vaults. The **Publish Vault**
tab pins metadata and encrypted dataset content to IPFS, so listings are shared through the Pinata
account and persist across deployments. Query fees for published vaults go to their configured payout account; sample
vault fees continue to go to the treasury.

### If the page looks stale

The app sends `Cache-Control: no-store` for `/`, but an already-cached tab can still survive a
deploy. Do a hard refresh (`Ctrl+Shift+R` / `Cmd+Shift+R`) or open the URL in a private window. The
current build shows **Pay 0.5 NEAR & ask**, **Payment confirmed**, and **Answer ready**; it does not
contain the old "simulated locally" copy.

---

## Local setup

### Prerequisites

- Node.js 20.9+
- npm
- A NEAR testnet wallet such as [MyNearWallet](https://testnet.mynearwallet.com/) or Meteor
- Testnet NEAR in that wallet for the query fee and network fee

### Install

```bash
git clone https://github.com/prosperlinho/blindsight.git
cd blindsight
npm install
```

### Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEAR_AI_API_KEY` | **Yes** | Server-side key for NEAR AI Cloud inference. |
| `NEXT_PUBLIC_BLINDSIGHT_TREASURY_ACCOUNT` | Recommended | Public treasury address shown to the browser. Defaults to `blindsight-ceeaa6612a.testnet`. |
| `BLINDSIGHT_TREASURY_ACCOUNT` | Optional | Server-side override for the same treasury. |
| `NEXT_PUBLIC_NEAR_NETWORK` | Optional | `testnet` (the only supported value). |
| `PINATA_API_KEY` | Required for published vaults | Pinata server-side API key. |
| `PINATA_SECRET_API_KEY` | Required for published vaults | Pinata server-side secret. Never expose it with a `NEXT_PUBLIC_` prefix. |
| `PUBLISHED_VAULT_ENCRYPTION_KEY` | Required for published vaults | Stable 32-byte hex key for AES-256-GCM dataset encryption. Back it up; rotating it makes existing uploads unreadable. |
| `PINATA_GATEWAY_URL` | Optional | Custom IPFS gateway base URL. Defaults to `https://gateway.pinata.cloud`. |

If you point the treasury at a different account, it must exist on testnet and the buyer must be able
to transfer to it. Verification only needs the public account address.

To enable shared publishing on Vercel, create Pinata API credentials and set `PINATA_API_KEY`,
`PINATA_SECRET_API_KEY`, and `PUBLISHED_VAULT_ENCRYPTION_KEY` in the deployment's server-side
environment. Generate the encryption key with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the encryption key stable and back it up. Metadata is pinned as JSON, and the Pinata account's
app-tagged metadata pins provide the shared discovery index. Dataset bytes are encrypted before
they are pinned separately. Without these values, sample vaults continue to work, while shared
listing and publishing are unavailable.

Without `NEAR_AI_API_KEY`, the app still boots and payments still verify, but a paid query returns
`INFERENCE_NOT_CONFIGURED`. The confirmed payment stays retryable after you add the key.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
  page.tsx                     Marketplace shell, real wallet state, RPC balance
  api/
    verify-payment/route.ts    Explicit "payment confirmed" endpoint
    query-tee/route.ts         Re-verify payment, resolve dataset, run inference
    vaults/route.ts            Shared IPFS marketplace listing and publishing
    vault/parse/route.ts       Real text/PDF extraction (rejects unreadable files)
components/
  QueryVault.tsx               Paid query console and stage machine
  ConnectModal.tsx             Real NEAR Wallet Selector connection
  PaymentAudit.tsx             Settlement/verification details and client audit log
  WalletProvider.tsx           Wallet Selector provider
lib/
  paymentConfig.ts             Treasury, RPC/explorer URLs, yocto helpers
  paymentVerification.ts       On-chain transfer verification
  nearAccount.ts               Real RPC balance, account-ID validation
  near-transfers.ts            Wallet signing and transaction-hash extraction
  nearWallet.ts                Wallet Selector setup and disconnect
  demoVaults.ts                Client-safe sample vault metadata
  demoVaultDatasets.ts         Server-only synthetic datasets
  publishedVaults.ts           Pinata metadata discovery and encrypted IPFS datasets
  datasetQuality.ts            Dataset preparation and in-memory cache
  auditLog.ts                  Client audit-log entry type
scripts/
```

---

## API contracts

### `POST /api/verify-payment`

```json
{
  "txHash": "…",
  "payerAccountId": "buyer.testnet",
  "vaultId": "q3-financial-market-demand"
}
```

Returns:

```json
{
  "success": true,
  "verified": true,
  "payment": {
    "txHash": "…",
    "payerAccountId": "buyer.testnet",
    "receiverId": "blindsight-ceeaa6612a.testnet",
    "amountNear": "0.5",
    "blockHeight": 123456789,
    "verifiedAt": "…"
  }
}
```

Failures return `{ success: false, verified: false, error, code }` with a 4xx status.

### `POST /api/query-tee`

```json
{
  "query": "Which segment grew fastest?",
  "txHash": "…",
  "payerAccountId": "buyer.testnet",
  "vaultId": "q3-financial-market-demand"
}
```

The server re-verifies the transfer, resolves sample data from the server catalog or published data
from IPFS, and then calls inference. Published dataset text is never included in the listing
response or sent back to the buyer.

A successful response includes `insight`, `receiptId` (the verified transaction hash), `payment`,
`inference` metadata, and a `prototype` object that states the TEE is mimicked and that the dataset
reference is dropped after inference. No attestation token is fabricated.

---

## Agent integration

Any agent that controls a NEAR testnet key can use the same rail without a browser wallet:

1. Sign a native NEAR transfer to the treasury for the vault's listed price.
2. POST the transaction hash, payer account ID, and `vaultId` to `/api/verify-payment`.
3. POST the same payment plus the question to `/api/query-tee`.

The server authenticates the payer from the on-chain signer and receiver, so no session or API key is
needed for the payment step. The inference key stays on the server.

---

---

## Security and limitations

This is a hackathon prototype, not a production confidential-computing service.

- **No hardware TEE.** The enclave is a server-side prototype and no hardware attestation is
  verified. The UI says so directly.
- **The server sees the data.** Dataset text is sent to the configured NEAR AI endpoint for
  inference. Use synthetic or non-sensitive data only.
- **There is no escrow contract.** Sample fees settle to the testnet treasury; published-vault fees
  settle directly to the configured publisher payout account.
- **Replay protection is best effort.** It uses an in-memory map and resets when a serverless
  instance restarts.
- **Anti-probing is heuristic.** It raises the cost of extraction; it does not make a dataset
  impossible to reconstruct.
- **Published files are encrypted on IPFS.** Metadata is public; dataset bytes are encrypted before
  pinning and decrypted server-side for paid inference. The app sends the dataset to NEAR AI after a
  paid query; use synthetic or non-sensitive data.

Do not use real personal, medical, financial, or confidential data with this prototype.
