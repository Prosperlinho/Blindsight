/**
 * Generate the two secrets the private Gloam rail needs.
 *
 *   node scripts/gloam-keygen.mjs
 *
 * Paste the output into .env.local. Do not commit these values.
 */

import { randomBytes } from "node:crypto";
import { generateReceiveKey } from "@gloamtrade/sdk";

const receiveKey = await generateReceiveKey();
const storeKey = randomBytes(32).toString("hex");

console.log("# Add these to .env.local and restart the server.");
console.log(`GLOAM_RECEIVE_KEY=${JSON.stringify(receiveKey)}`);
console.log(`GLOAM_NOTE_STORE_KEY=${storeKey}`);
console.log("");
console.log(`Receive tag (safe to share): ${receiveKey.tag}`);
