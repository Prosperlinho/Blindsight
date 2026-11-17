/**
 * Browser-side sealing of a dataset to the BlindSight enclave, so the
 * plaintext never reaches BlindSight's web server. Mirrors sealForEnclave in
 * lib/enclaveProtocol.ts using WebCrypto (X25519 is supported in current
 * Chrome, Edge, Firefox and Safari).
 */

const SEAL_SCHEME = "x25519-hkdf-sha256-aes256gcm";
const SEAL_HKDF_INFO = "blindsight vault seal v2";
const SEAL_AAD = "blindsight-vault-v2";

export type BrowserSealedDataset = {
  version: 2;
  scheme: typeof SEAL_SCHEME;
  enclaveKey: string;
  epk: string;
  iv: string;
  ciphertext: string;
};

function toBase64(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export class SealingUnsupportedError extends Error {
  constructor() {
    super("This browser can't encrypt datasets for the enclave. Update your browser and try again.");
    this.name = "SealingUnsupportedError";
  }
}

export async function sealForEnclaveInBrowser(plaintext: string, enclavePublicKeyBase64: string): Promise<BrowserSealedDataset> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new SealingUnsupportedError();
  const enclaveKeyBytes = fromBase64(enclavePublicKeyBase64);
  if (enclaveKeyBytes.length !== 32) throw new Error("The enclave key is invalid.");

  let ephemeral: CryptoKeyPair;
  let enclaveKey: CryptoKey;
  try {
    ephemeral = await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]) as CryptoKeyPair;
    enclaveKey = await subtle.importKey("raw", enclaveKeyBytes, { name: "X25519" }, false, []);
  } catch {
    throw new SealingUnsupportedError();
  }
  const epk = new Uint8Array(await subtle.exportKey("raw", ephemeral.publicKey));
  const shared = await subtle.deriveBits({ name: "X25519", public: enclaveKey }, ephemeral.privateKey, 256);

  const salt = new Uint8Array(epk.length + enclaveKeyBytes.length);
  salt.set(epk, 0);
  salt.set(enclaveKeyBytes, epk.length);
  const hkdfKey = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aesKey = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(SEAL_HKDF_INFO) },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(SEAL_AAD) },
    aesKey,
    new TextEncoder().encode(plaintext),
  );

  return {
    version: 2,
    scheme: SEAL_SCHEME,
    enclaveKey: enclavePublicKeyBase64,
    epk: toBase64(epk),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}
