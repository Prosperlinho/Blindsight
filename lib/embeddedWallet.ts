import { KeyPair, keyToImplicitAddress, type KeyPairString } from "near-api-js";

const PRIVATE_KEY_STORAGE_KEY = "blindsight_private_key";
const ACCOUNT_ID_STORAGE_KEY = "blindsight_account_id";

export type EmbeddedWallet = {
  accountId: string;
  publicKey: string;
  keyPair: KeyPair;
};

export function createInstantWallet(): EmbeddedWallet {
  if (typeof window === "undefined") {
    throw new Error("An embedded wallet can only be created in a browser.");
  }

  const keyPair = KeyPair.fromRandom("ed25519");
  const publicKey = keyPair.getPublicKey().toString();
  const accountId = keyToImplicitAddress(publicKey);

  window.localStorage.setItem(PRIVATE_KEY_STORAGE_KEY, keyPair.toString());
  window.localStorage.setItem(ACCOUNT_ID_STORAGE_KEY, accountId);

  return { accountId, publicKey, keyPair };
}

export function exportPrivateKey(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(PRIVATE_KEY_STORAGE_KEY);
}

export function importPrivateKey(secretKey: string): string {
  if (typeof window === "undefined") {
    throw new Error("An embedded wallet can only be imported in a browser.");
  }

  const normalizedKey = secretKey.trim();
  if (!normalizedKey.startsWith("ed25519:")) {
    throw new Error("Enter a valid Ed25519 private key beginning with ed25519:.");
  }

  let keyPair: KeyPair;
  try {
    keyPair = KeyPair.fromString(normalizedKey as KeyPairString);
  } catch {
    throw new Error("The private key is invalid. Check the key and try again.");
  }

  const accountId = keyToImplicitAddress(keyPair.getPublicKey().toString());
  window.localStorage.setItem(PRIVATE_KEY_STORAGE_KEY, keyPair.toString());
  window.localStorage.setItem(ACCOUNT_ID_STORAGE_KEY, accountId);

  return accountId;
}

export function getStoredEmbeddedWallet(): EmbeddedWallet | null {
  if (typeof window === "undefined") {
    return null;
  }

  const privateKey = window.localStorage.getItem(PRIVATE_KEY_STORAGE_KEY);
  const storedAccountId = window.localStorage.getItem(ACCOUNT_ID_STORAGE_KEY);
  if (!privateKey || !storedAccountId) {
    return null;
  }
  if (!privateKey.startsWith("ed25519:")) {
    throw new Error("The stored embedded wallet key is not a valid Ed25519 key.");
  }

  const keyPair = KeyPair.fromString(privateKey as KeyPairString);
  const publicKey = keyPair.getPublicKey().toString();
  const accountId = keyToImplicitAddress(publicKey);
  if (accountId !== storedAccountId) {
    throw new Error("The stored embedded wallet key does not match its account ID.");
  }

  return { accountId, publicKey, keyPair };
}

export function disconnectEmbeddedWallet() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(PRIVATE_KEY_STORAGE_KEY);
  window.localStorage.removeItem(ACCOUNT_ID_STORAGE_KEY);
}
