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

## Real vs simulated

BlindSight is deliberately explicit about which parts are real, because a judge should be able to
verify the payment and the answer independently.

| Area | Status | What actually happens |
| --- | --- | --- |
| Wallet connection | **Real** | NEAR Wallet Selector with MyNearWallet and Meteor on `testnet`. The connected account comes from Wallet Selector state. |
| Account balance | **Real** | Read from the public FastNear testnet RPC (`view_account`). There is no local ledger or minted balance. |
| Query payment | **Real** | The buyer signs a native NEAR transfer to the funded treasury `blindsight-ceeaa6612a.testnet`. |
| Payment verification | **Real** | The server fetches the finalized transaction from `https://rpc.testnet.fastnear.com` and checks signer, receiver, amount, execution status, and age. |
| Answer gating | **Real** | `/api/verify-payment` confirms the transfer, then `/api/query-tee` re-verifies the same hash before inference runs. |
| AI inference | **Real** | The server calls NEAR AI Cloud (`zai-org/GLM-5.1-FP8`) with `NEAR_AI_API_KEY`. |
| Sample datasets | **Fictional data, real gating** | Three synthetic datasets live in server-only code. The browser only sends a `vaultId`. |
| Dataset lifecycle | **Simulated enclave** | The route drops its prepared dataset reference after inference. JavaScript cannot guarantee heap zeroing, and this is not hardware isolation. |
| TEE / enclave attestation | **Simulated** | The UI shows a deterministic token derived from the payment hash and answer. No hardware attestation exists. |
| Publisher payout | **Not executed** | Sample publishers are fictional. The full query fee settles to the BlindSight treasury. |
| Anti-probing checks | **Best effort** | In-memory query history and pattern checks per server instance. Not a guarantee against dataset reconstruction. |
| Replay protection | **Best effort** | In-memory, per-instance map with a 24-hour TTL. It is not a network-wide nonce. |
| Gloam shielded rail | **Not integrated** | See [Why there is no shielded rail](#why-there-is-no-shielded-rail). |

There are no faucet buttons, local balances, mock addresses, fake transaction hashes, or simulated
payment-success paths in the app.

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

1. **Payment pending** — the wallet is open and the transfer is awaiting approval.
2. **Verifying** — the transaction hash has been submitted and the server is checking the RPC.
3. **Payment confirmed** — the amount, receiver, block height, and explorer link are displayed.
4. **Answer ready** — the insight appears with the same transaction hash and the inference model.
5. **Error** — the failure reason is displayed. If the payment was already confirmed, the answer can
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

1. Open [https://blindsight-zeta.vercel.app/](https://blindsight-zeta.vercel.app/).
2. Click **Connect Wallet** and choose a NEAR testnet wallet.
3. Fund the account from a NEAR testnet faucet if it has no testnet NEAR. This is an external
   prerequisite; the app itself has no faucet.
4. Keep one of the preloaded sample vaults selected:
   - **Q3 Financial & Market Demand** — 0.05 NEAR
   - **Medical Research Cohort 2026** — 0.08 NEAR
   - **Solidity Security Audit Report** — 0.04 NEAR
5. Ask a question, for example:
   - *Which segment has the highest year-over-year growth?*
   - *Summarize the most serious open security findings.*
6. Click **Pay … NEAR & ask**.
7. Approve the transfer in the wallet.
8. Watch the three steps: **Sign NEAR payment → Verify on-chain → Generate answer**.
9. Confirm the green **Payment confirmed on NEAR testnet** panel and open the NEARBlocks link.
10. The answer appears below. Its transaction hash is the same one you just verified on-chain.

Verification plus inference typically takes 5–30 seconds. The wallet also charges a small network
fee. If inference times out, the confirmed payment remains retryable.

The **Vault Explorer** lets you switch between the three samples. The **Publish Vault** tab creates a
browser-session listing from your own text files; publishing is local to the session, while every
query still settles with a real testnet transfer to the treasury.

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

If you point the treasury at a different account, it must exist on testnet and the buyer must be able
to transfer to it. Verification only needs the public account address.

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
  datasetQuality.ts            Dataset preparation and in-memory cache
  auditLog.ts                  Client audit-log entry type
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
    "amountNear": "0.05",
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

The server re-verifies the transfer, resolves the sample dataset by `vaultId`, and then calls
inference. Session-published vaults send their dataset in the request instead of a `vaultId`.

A successful response includes `insight`, `receiptId` (the verified transaction hash), `payment`,
`inference` metadata, and an explicitly labeled `attestation` object with `simulated: true`.

---

## Agent integration

Any agent that controls a NEAR testnet key can use the same rail without a browser wallet:

1. Sign a native NEAR transfer to the treasury for the vault's listed price.
2. POST the transaction hash, payer account ID, and `vaultId` to `/api/verify-payment`.
3. POST the same payment plus the question to `/api/query-tee`.

The server authenticates the payer from the on-chain signer and receiver, so no session or API key is
needed for the payment step. The inference key stays on the server.

---

## Why there is no shielded rail

`@gloamtrade/sdk` is an **EVM** privacy rail (Tempo, Robinhood, Base, Ethereum). Its deposit and
zero-knowledge proof flow requires an EVM wallet, `snarkjs`, circuit artifacts, and funded testnet
stablecoin. NEAR Wallet Selector cannot sign those transactions, and this build intentionally ships
only one real payment rail.

The earlier simulated Gloam receipt UI was removed rather than presented as a real private payment.
Adding Gloam would mean adding a second wallet stack and a funded EVM testnet environment; that is
outside this NEAR-only prototype.

---

## Security and limitations

This is a hackathon prototype, not a production confidential-computing service.

- **No hardware TEE.** Attestation is a deterministic label, not a hardware quote.
- **The server sees the data.** Dataset text is sent to the configured NEAR AI endpoint for
  inference. Use synthetic or non-sensitive data only.
- **The treasury is custodial.** Fees settle to a single testnet account. There is no escrow contract
  and no publisher payout.
- **Replay protection is best effort.** It uses an in-memory map and resets when a serverless
  instance restarts.
- **Anti-probing is heuristic.** It raises the cost of extraction; it does not make a dataset
  impossible to reconstruct.
- **Session vaults are browser-local.** Publishing does not write to a contract or IPFS. The dataset
  is sent to the server only when a paid query runs.

Do not use real personal, medical, financial, or confidential data with this prototype.
