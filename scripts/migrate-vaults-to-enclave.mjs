#!/usr/bin/env node
/**
 * One-time migration: re-seals published vaults that were encrypted with the
 * server-side key (version 1) to the BlindSight enclave (version 2), so the
 * web server no longer needs PUBLISHED_VAULT_ENCRYPTION_KEY.
 *
 * Run it on a trusted machine after the enclave is deployed and enclave mode
 * is live (GET <site>/api/enclave returns enabled: true):
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... PUBLISHED_VAULT_ENCRYPTION_KEY=... \
 *   BLINDSIGHT_URL=https://blindsight-zeta.vercel.app \
 *   node scripts/migrate-vaults-to-enclave.mjs [--apply]
 *
 * Without --apply it only reports what it would do. Before replacing a file
 * it writes the original (still encrypted) blob to ./vault-backups/. After a
 * successful run, remove PUBLISHED_VAULT_ENCRYPTION_KEY from Vercel.
 *
 * The sealing below must match lib/enclaveProtocol.ts (sealForEnclave).
 */
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const BUCKET = "vault-datasets";
const apply = process.argv.includes("--apply");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

const supabaseUrl = required("SUPABASE_URL").replace(/\/+$/, "");
const anonKey = required("SUPABASE_ANON_KEY");
const legacyKey = Buffer.from(required("PUBLISHED_VAULT_ENCRYPTION_KEY").replace(/^0x/i, ""), "hex");
const siteUrl = required("BLINDSIGHT_URL").replace(/\/+$/, "");
const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

// The site has already verified the enclave's attestation before serving this.
const enclave = await (await fetch(`${siteUrl}/api/enclave`, { cache: "no-store" })).json();
if (!enclave.enabled || !enclave.sealPublicKey) {
  console.error("Enclave mode is not live on that site:", enclave.error ?? "enabled is false");
  process.exit(1);
}
const enclaveKey = Buffer.from(enclave.sealPublicKey, "base64");
console.log(`Enclave verified by ${siteUrl}: compose ${enclave.composeHash}, TCB ${enclave.tcbStatus}`);

function decryptLegacy(blob) {
  const decipher = createDecipheriv("aes-256-gcm", legacyKey, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function seal(plaintext) {
  const ephemeral = generateKeyPairSync("x25519");
  const epkDer = createPublicKey(ephemeral.privateKey).export({ format: "der", type: "spki" });
  const epk = Buffer.from(epkDer.subarray(epkDer.length - 32));
  const enclavePublic = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), enclaveKey]),
    format: "der",
    type: "spki",
  });
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: enclavePublic });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([epk, enclaveKey]), "blindsight vault seal v2", 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("blindsight-vault-v2"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return {
    version: 2,
    scheme: "x25519-hkdf-sha256-aes256gcm",
    enclaveKey: enclaveKey.toString("base64"),
    epk: epk.toString("base64"),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

const rowsResponse = await fetch(`${supabaseUrl}/rest/v1/vaults?select=id,title,file_reference`, { headers });
if (!rowsResponse.ok) {
  console.error(`Could not list vaults: HTTP ${rowsResponse.status}`);
  process.exit(1);
}
const rows = await rowsResponse.json();
mkdirSync("vault-backups", { recursive: true });

let migrated = 0;
for (const row of rows) {
  const objectUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${row.file_reference}`;
  const blob = await (await fetch(objectUrl, { headers })).json().catch(() => null);
  if (blob?.version === 2) {
    console.log(`= ${row.id} already sealed to the enclave`);
    continue;
  }
  if (blob?.version !== 1) {
    console.warn(`! ${row.id} has an unknown format; skipped`);
    continue;
  }
  let plaintext;
  try {
    plaintext = decryptLegacy(blob);
  } catch {
    console.warn(`! ${row.id} could not be decrypted with this key; skipped`);
    continue;
  }
  if (!apply) {
    console.log(`~ ${row.id} would be re-sealed (${Buffer.byteLength(plaintext)} bytes)`);
    continue;
  }
  const sealed = seal(plaintext);
  writeFileSync(`vault-backups/${row.file_reference}`, JSON.stringify(blob));
  const removed = await fetch(objectUrl, { method: "DELETE", headers });
  if (!removed.ok) {
    console.error(`! ${row.id}: could not remove the old file (HTTP ${removed.status}); skipped`);
    continue;
  }
  const uploaded = await fetch(objectUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(sealed),
  });
  if (!uploaded.ok) {
    console.error(`!! ${row.id}: upload failed (HTTP ${uploaded.status}). Restore from vault-backups/${row.file_reference}.`);
    process.exitCode = 1;
    continue;
  }
  migrated += 1;
  console.log(`+ ${row.id} re-sealed to the enclave`);
}

console.log(apply ? `Done: ${migrated} vault(s) migrated.` : "Dry run only. Re-run with --apply to migrate.");
