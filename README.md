# Blindsight

> Sell answers from your files, never the files.

Blindsight is a prototype confidential data marketplace built around NEAR Protocol and Trusted Execution Environment (TEE) workflows. It explores how data owners could make private documents—such as PDFs, CSVs, text, and code—available for AI-powered questions without giving buyers direct access to the original files.

**Live App:** [https://blindsight-zeta.vercel.app/](https://blindsight-zeta.vercel.app/)

> **Prototype notice:** This MVP does not provide production TEE isolation or hardware attestation. Attestation, privacy noise, encryption previews, and NEAR settlement are simulated. Query content and prepared dataset text are sent to the configured NEAR AI Cloud endpoint for inference. Do not upload sensitive or confidential data.

---

## Key Features

- **TEE workflow preview:** Visualizes an enclave-attestation workflow. AMD SEV-SNP and other hardware verification shown in the UI are simulated, not verified hardware claims.
- **Anti-probing checks:** Server-side query-history, repetition, and rate-limit checks are used to block some targeted extraction patterns. They are MVP safeguards, not a guarantee against dataset reconstruction.
- **Instant embedded wallet:** Generates an Ed25519 keypair with `near-api-js` and supports importing or exporting the private key. The key is stored in browser `localStorage`; anyone who obtains it can control the wallet.
- **Universal file ingestion:** Accepts uploaded file types and attempts text extraction, PDF parsing, and printable-text buffer fallback. Extraction quality varies by format and file content.
- **Settlement workflow preview:** Displays a simulated NEAR Intents payout after an accepted mock attestation. No on-chain transaction or real payout is made.
- **Judge demo mode:** Loads sample financial data and prepares a demo query flow.

---

## Tech Stack

- **Framework:** Next.js App Router, React, TypeScript, Tailwind CSS
- **Blockchain and wallets:** NEAR Protocol, `near-api-js`, NEAR Wallet Selector
- **Inference:** NEAR AI Cloud API
- **File processing:** `pdf-parse` and Node.js buffers
- **Deployment:** Vercel

---

## Local Development Setup

### Prerequisites

- Node.js 20.9 or later
- npm

### Installation

```bash
git clone https://github.com/prosperlinho/blindsight.git
cd blindsight
npm install
```

### Environment

Create `.env.local` in the project root and add your NEAR AI Cloud API key:

```env
NEAR_AI_API_KEY=your_api_key
```

Keep API keys private. The application can start without this value, but query inference will not work.

### Run the application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

---

## Current MVP Flow

1. Add a dataset or load the sample financial dataset.
2. The application parses the file and prepares dataset text for queries.
3. Encrypt-preview, valuation, and escrow steps are presented as workflow UI; they do not represent production encryption or a real escrow contract.
4. Submit a question to the server. The server applies its anti-probing checks and sends the prepared text and question to NEAR AI Cloud.
5. The UI displays the returned insight and demo security metadata.

## Security and Privacy

This repository is a hackathon/MVP prototype, not a production confidential-computing service. In particular:

- The current inference path does not run inside a verified TEE.
- Attestation tokens, query noise, encryption previews, and settlement hashes are simulated.
- Dataset text is sent to the configured inference provider.
- Embedded wallet private keys are stored in browser `localStorage` and are not protected by a hardware-backed wallet.

Use synthetic or otherwise non-sensitive data when testing. Do not rely on the current prototype to protect confidential information or execute real financial transactions.
