# BlindSight enclave

The enclave is the only place a published dataset is ever decrypted. It runs on
[Phala Cloud](https://cloud.phala.network) inside an Intel TDX confidential VM
(dstack). The BlindSight web server on Vercel never sees dataset plaintext once
enclave mode is on.

## How it works

1. On start, the enclave derives two keys from dstack's key service
   (`getKey`). The keys are bound to this Phala app, so they exist only inside
   its attested VMs, and they survive restarts and upgrades of the same app:
   - an **X25519 sealing key**: publishers' browsers encrypt datasets to it;
   - an **Ed25519 signing key**: the enclave signs every response with it.
2. `GET /attestation?nonce=<32 bytes hex>` returns a TDX quote whose
   `report_data` is `SHA-256("blindsight-enclave-v1" || sealKey || signKey || nonce)`,
   plus the RTMR3 event log and `app-compose.json`.
3. The web server (`lib/enclaveClient.ts`) verifies, with a fresh nonce, that
   the quote is valid under Intel's certificate chain (accepted TCB status,
   debug mode off), that it binds both keys to the nonce, and that the replayed
   RTMR3 log contains the **pinned compose hash**. That last check means the
   enclave runs exactly this published code.
4. `POST /validate` and `POST /answer` (bearer-token protected) open the sealed
   dataset, apply the aggregate-only guard, build the prompt, and ask NEAR AI
   over attested OHTTP. This is the same `lib/` code the web server uses in
   direct mode. Every response carries an `x-enclave-signature` that the web
   server checks before accepting it.

The enclave never logs questions, datasets or answers.

## What you still trust

- **Phala's OS image and key service.** The web server checks the app layer
  (RTMR3 and the compose hash) but not MRTD or RTMR0-2 against Phala's
  published OS measurements. Phala's key service only releases app keys to
  approved OS images. For a full check, run Phala's `dstack-verifier` on the
  evidence published at `/api/enclave`.
- **The app owner's upgrades.** Keys stay the same across upgrades of the same
  Phala app, so whoever controls the app could deploy new code that reads
  datasets. That new code would have a different compose hash. The web server
  refuses it until `ENCLAVE_COMPOSE_HASH` is updated, and anyone can see the
  change at `/api/enclave`.
- **Phala's gateway for TLS.** `*.phala.network` URLs terminate TLS in Phala's
  gateway, which is itself a TEE. The question travels from Vercel to the
  enclave over that TLS. The dataset itself travels sealed.

## Deploy

### 1. Build the image

Push to `main` and the **Enclave image** GitHub workflow builds and publishes
`ghcr.io/<owner>/blindsight-enclave`. You can also run it manually from the
Actions tab. Its summary prints the image digest. Make the package public in
GitHub (Packages → blindsight-enclave → Package settings) so Phala can pull it.

To build locally instead, from the repository root:

```bash
docker build -f enclave/Dockerfile -t ghcr.io/<owner>/blindsight-enclave:latest .
docker push ghcr.io/<owner>/blindsight-enclave:latest
```

### 2. Pin the image

In `enclave/docker-compose.yml`, replace `REPLACE_WITH_IMAGE_DIGEST` with the
digest, for example `ghcr.io/prosperlinho/blindsight-enclave@sha256:…`. Pinning
by digest means the compose hash identifies exactly one build.

### 3. Create secrets

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Put the result and your NEAR AI key in a local file that you don't commit, for
example `enclave/enclave.env`:

```
NEAR_AI_API_KEY=...
ENCLAVE_API_TOKEN=...
```

### 4. Deploy to Phala Cloud

```bash
npx phala login
npx phala deploy -n blindsight-enclave -c enclave/docker-compose.yml -e enclave/enclave.env --wait
```

Environment variables are encrypted to the confidential VM and readable only
inside it. The public URL has the form
`https://<app-id>-8080.<cluster>.phala.network`. Check it responds:

```bash
curl https://<app-id>-8080.<cluster>.phala.network/health
```

Check the keys come from Phala's key service (KMS, on by default for Phala
Cloud apps): restart the app in the Phala dashboard and confirm
`sealPublicKey` from `/attestation` is unchanged. If it changes on restart,
sealed vaults would become unreadable, so don't publish until it's stable.

### 5. Read the compose hash

```bash
curl "https://<app-id>-8080.<cluster>.phala.network/attestation?nonce=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
```

Note `composeHash` and `appId` from the response. `composeHash` should equal
the SHA-256 of the returned `appCompose` string.

### 6. Turn on enclave mode in Vercel

Set these for Production, then redeploy:

| Variable | Value |
| --- | --- |
| `ENCLAVE_URL` | `https://<app-id>-8080.<cluster>.phala.network` |
| `ENCLAVE_API_TOKEN` | the token from step 3 |
| `ENCLAVE_COMPOSE_HASH` | `composeHash` from step 5 |
| `ENCLAVE_APP_ID` | `appId` from step 5 (optional, recommended) |

`https://<site>/api/enclave` should now return `"enabled": true` with the same
compose hash.

### 7. Move existing vaults into the enclave

Vaults published before enclave mode are encrypted with the server key. Re-seal
them, and back up the originals, with:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... PUBLISHED_VAULT_ENCRYPTION_KEY=... \
BLINDSIGHT_URL=https://<site> node scripts/migrate-vaults-to-enclave.mjs          # dry run
SUPABASE_URL=... SUPABASE_ANON_KEY=... PUBLISHED_VAULT_ENCRYPTION_KEY=... \
BLINDSIGHT_URL=https://<site> node scripts/migrate-vaults-to-enclave.mjs --apply
```

Then delete `PUBLISHED_VAULT_ENCRYPTION_KEY` from Vercel. Until a legacy vault
is migrated, questions to it return `VAULT_NEEDS_MIGRATION`.

## Updating the enclave

Build a new image, pin its digest, and run
`npx phala deploy --cvm-id <app-id> -c enclave/docker-compose.yml`. The compose
hash changes, so update `ENCLAVE_COMPOSE_HASH` in Vercel and redeploy. Until
then the web server refuses the new build and buyers get a retryable error.
Their payments stay valid. Sealed vaults stay readable because the app's keys
don't change.

## Local development

`DSTACK_SIMULATOR_ENDPOINT` points the dstack SDK at Phala's simulator:

```bash
cd enclave && npm install && npm run build
DSTACK_SIMULATOR_ENDPOINT=http://localhost:8090 ENCLAVE_API_TOKEN=<32+ chars> NEAR_AI_API_KEY=... npm start
```

Simulator quotes are not genuine Intel quotes, so the web server's
verification rejects them.
