/**
 * Real end-to-end test of the Gloam private query rail on Robinhood Chain
 * testnet.
 *
 * Start the app with the GLOAM_* values from `gloam-keygen.mjs`, then run:
 *
 *   PAYER_PRIVATE_KEY=0x... node scripts/gloam-testnet-e2e.mjs
 *
 * Optional:
 *   APP_URL=http://localhost:3000
 *   VAULT_ID=q3-financial-market-demand
 *   QUERY="Summarize the headline metrics"
 *   SHIELD_ETH=0.002
 *
 * The payer wallet needs a little testnet ETH for gas and for the first
 * shielded deposit. The script is idempotent for the deposit: it reuses a
 * locally stored note whenever one covers the price.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  GLOAM_NETWORKS,
  NATIVE_ASSET,
  POOL_TRANSFER_ABI,
  artifactProver,
  buildGloamPayment,
  buildShieldBoundIntent,
  circuitArtifactFiles,
  circuitArtifactUrls,
  gloamReadTransport,
  syncTree,
  transferCallArgs,
} from "@gloamtrade/sdk";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SHIELD_BOUND_ABI = [{
  type: "function",
  name: "shieldBound",
  stateMutability: "payable",
  inputs: [
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "commitment", type: "bytes32" },
    { name: "proof", type: "bytes" },
  ],
  outputs: [],
}];

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const VAULT_ID = process.env.VAULT_ID ?? "q3-financial-market-demand";
const QUERY = process.env.QUERY ?? "Summarize the headline metrics and the biggest risk.";
const SHIELD_ETH = process.env.SHIELD_ETH ?? "0.002";
const NOTES_PATH = process.env.GLOAM_E2E_NOTES_PATH ?? join(process.cwd(), ".gloam-e2e-notes.json");
const CIRCUIT_CACHE = join(tmpdir(), "blindsight-gloam-circuits");

const NETWORK = GLOAM_NETWORKS.robinhood;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function ensureCircuit(circuit) {
  const files = circuitArtifactFiles(circuit, NETWORK.ceremony);
  const urls = circuitArtifactUrls(circuit, NETWORK.chainId);

  async function fetchChecked(url, relativePath, expected) {
    const localPath = join(CIRCUIT_CACHE, relativePath);
    try {
      const existing = await readFile(localPath);
      if (sha256(existing) === expected) return localPath;
    } catch {
      // Missing or stale: download below.
    }

    console.log(`  downloading ${relativePath}…`);
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) fail(`Could not download ${url} (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== expected) fail(`Proof file ${relativePath} failed its integrity check.`);
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes);
    return localPath;
  }

  return {
    wasm: await fetchChecked(urls.wasm, files.wasm, files.sha256.wasm),
    zkey: await fetchChecked(urls.zkey, files.zkey, files.sha256.zkey),
  };
}

async function loadNotes() {
  try {
    const parsed = JSON.parse(await readFile(NOTES_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveNotes(notes) {
  await writeFile(NOTES_PATH, JSON.stringify(notes, null, 2), { mode: 0o600 });
}

function pickNote(notes, requiredWei) {
  return notes
    .filter((note) => (
      note.chainId === NETWORK.chainId
      && String(note.asset).toLowerCase() === NATIVE_ASSET.toLowerCase()
      && BigInt(note.amountWei) >= requiredWei
    ))
    .sort((left, right) => (BigInt(left.amountWei) < BigInt(right.amountWei) ? -1 : 1))[0];
}

const privateKey = process.env.PAYER_PRIVATE_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "")) {
  fail("Set PAYER_PRIVATE_KEY to a funded EVM testnet private key (0x + 64 hex chars).");
}

const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: NETWORK.chain, transport: gloamReadTransport(NETWORK) });
const wallet = createWalletClient({ account, chain: NETWORK.chain, transport: http(NETWORK.rpcUrl) });

console.log(`Payer: ${account.address}`);
console.log(`App:   ${APP_URL}`);
console.log(`Vault: ${VAULT_ID}`);

// 1. Ask the app what this query costs and where to send it.
let requirements;
try {
  const response = await fetch(`${APP_URL}/api/gloam/requirements?vaultId=${encodeURIComponent(VAULT_ID)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.requirements) {
    fail(body.error || "The app did not return private payment requirements. Is it running with GLOAM_RECEIVE_KEY set?");
  }
  requirements = body.requirements;
} catch (error) {
  fail(`Could not reach the app at ${APP_URL}: ${error instanceof Error ? error.message : error}`);
}

const requiredWei = BigInt(requirements.maxAmountRequired);
console.log(`Price: ${formatEther(requiredWei)} ETH on ${NETWORK.label} (${NETWORK.chainId})`);

// 2. Make sure the payer has a private note that covers the price.
let notes = await loadNotes();
let note = pickNote(notes, requiredWei);

if (!note) {
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`Wallet balance: ${formatEther(ethBalance)} ETH`);
  if (ethBalance <= parseEther(SHIELD_ETH)) {
    fail(`Fund ${account.address} with testnet ETH first (need more than ${SHIELD_ETH} ETH for the deposit plus gas).`);
  }

  console.log("\nShielding a private balance…");
  const artifacts = await ensureCircuit("shield");
  const intent = await buildShieldBoundIntent({
    chainId: NETWORK.chainId,
    poolAddress: NETWORK.pool,
    asset: NATIVE_ASSET,
    amountWei: parseEther(SHIELD_ETH),
    prover: artifactProver(artifacts),
    client: publicClient,
  });

  const hash = await wallet.writeContract({
    address: intent.exec.poolAddress,
    abi: SHIELD_BOUND_ABI,
    functionName: "shieldBound",
    args: intent.exec.args,
    value: intent.exec.valueWei,
  });
  console.log(`  deposit tx: ${hash}`);
  const depositReceipt = await publicClient.waitForTransactionReceipt({ hash });
  if (depositReceipt.status !== "success") fail(`Deposit ${hash} reverted.`);

  note = {
    secret: intent.note.secret,
    commitment: intent.note.commitment,
    amountWei: parseEther(SHIELD_ETH).toString(),
    asset: NATIVE_ASSET,
    chainId: NETWORK.chainId,
    createdAt: Date.now(),
  };
  notes = [...notes, note];
  await saveNotes(notes);
  console.log(`  private balance: ${formatEther(BigInt(note.amountWei))} ETH`);
}

// 3. Sync the pool tree and prove the private transfer to BlindSight.
console.log("\nSyncing the shielded pool…");
const synced = await syncTree(publicClient, {
  pool: NETWORK.pool,
  fromBlock: NETWORK.deployBlock,
});
const path = await synced.pathForCommitment(note.commitment);
if (!path) fail("The shielded note is not in the pool tree yet. Wait a few seconds and run again.");

console.log("Proving the private payment (this can take a moment)…");
const transferArtifacts = await ensureCircuit("transfer");
const payment = await buildGloamPayment({
  requirements,
  senderSecretHex: note.secret,
  senderNoteAmountWei: BigInt(note.amountWei),
  path,
  prove: artifactProver(transferArtifacts),
});

console.log("Broadcasting the private payment…");
const payHash = await wallet.writeContract({
  address: payment.intent.exec.poolAddress,
  abi: POOL_TRANSFER_ABI,
  functionName: "transfer",
  args: transferCallArgs(payment.intent),
});
payment.payload.payload.txHash = payHash;
console.log(`  payment tx: ${payHash}`);
const payReceipt = await publicClient.waitForTransactionReceipt({ hash: payHash });
if (payReceipt.status !== "success") fail(`Payment ${payHash} reverted.`);

notes = notes.filter((entry) => entry.commitment !== note.commitment);
if (BigInt(payment.changeNote.amountWei) > 0n) {
  notes.push({
    secret: payment.changeNote.secret,
    commitment: payment.changeNote.commitment,
    amountWei: payment.changeNote.amountWei,
    asset: payment.changeNote.asset,
    chainId: NETWORK.chainId,
    createdAt: Date.now(),
  });
}
await saveNotes(notes);
console.log(`  remaining private balance: ${formatEther(BigInt(payment.changeNote.amountWei))} ETH`);

// 4. The server settles, sweeps, and runs the answer.
console.log("\nSending the paid query…");
const response = await fetch(`${APP_URL}/api/query-tee`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    vaultId: VAULT_ID,
    query: QUERY,
    paymentType: "GLOAM",
    payload: payment.payload,
  }),
});
const result = await response.json().catch(() => ({}));

if (!response.ok) {
  fail(`Query failed (${response.status}): ${result.error || "no error message"}`);
}
if (typeof result.insight !== "string" || !result.insight.trim()) {
  fail("The server accepted the payment but returned no answer.");
}

console.log("\n✔ Private payment settled and answered.\n");
console.log(result.insight);
