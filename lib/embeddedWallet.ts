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

export type WalletTransactionType = "FAUCET_CREDIT" | "QUERY_DEBIT";
export type WalletTransactionStatus = "SUCCESS" | "CONFIRMED";

export type WalletTransaction = {
  id: string;
  type: WalletTransactionType;
  amount: string;
  description: string;
  recipient?: string;
  status: WalletTransactionStatus;
  timestamp: string;
};

export type WalletLedger = {
  accountId: string;
  address: string;
  balanceNear: number;
  transactions: WalletTransaction[];
};

export type QuerySettlementResult = {
  success: boolean;
  message?: string;
  transactionId?: string;
};

export const INITIAL_TEST_BALANCE_NEAR = 2;
const WALLET_LEDGER_STORAGE_PREFIX = "blindsight_wallet_ledger_v1";

function ledgerStorageKey(accountId: string) {
  return `${WALLET_LEDGER_STORAGE_PREFIX}:${accountId}`;
}

export function formatNearAddress(accountId: string): string {
  const normalized = accountId.trim();
  if (!normalized) return "blindsight-user.testnet";
  if (normalized.endsWith(".near") || normalized.endsWith(".testnet")) return normalized;
  const compact = normalized.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `blindsight-${compact.slice(0, 8) || "user"}.testnet`;
}

export function roundNear(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatNearAmount(value: number): string {
  return `${roundNear(value).toFixed(2)} NEAR`;
}

function createFaucetTransaction(): WalletTransaction {
  return {
    id: "tx-faucet-01",
    type: "FAUCET_CREDIT",
    amount: "+2.00 NEAR",
    description: "Test Faucet Signup Bonus",
    status: "SUCCESS",
    timestamp: "Just now",
  };
}

export function createWalletLedger(accountId: string): WalletLedger {
  return {
    accountId,
    address: formatNearAddress(accountId),
    balanceNear: INITIAL_TEST_BALANCE_NEAR,
    transactions: [createFaucetTransaction()],
  };
}

function isWalletTransaction(value: unknown): value is WalletTransaction {
  if (!value || typeof value !== "object") return false;
  const transaction = value as Partial<WalletTransaction>;
  return typeof transaction.id === "string"
    && (transaction.type === "FAUCET_CREDIT" || transaction.type === "QUERY_DEBIT")
    && typeof transaction.amount === "string"
    && typeof transaction.description === "string"
    && (transaction.recipient === undefined || typeof transaction.recipient === "string")
    && (transaction.status === "SUCCESS" || transaction.status === "CONFIRMED")
    && typeof transaction.timestamp === "string";
}

export function loadWalletLedger(accountId: string): WalletLedger | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawLedger = window.localStorage.getItem(ledgerStorageKey(accountId));
    if (!rawLedger) return null;

    const parsed = JSON.parse(rawLedger) as Partial<WalletLedger> | null;
    if (!parsed || parsed.accountId !== accountId || typeof parsed.balanceNear !== "number") {
      return null;
    }

    return {
      accountId,
      address: typeof parsed.address === "string" && parsed.address
        ? parsed.address
        : formatNearAddress(accountId),
      balanceNear: Math.max(0, roundNear(parsed.balanceNear)),
      transactions: Array.isArray(parsed.transactions)
        ? parsed.transactions.filter(isWalletTransaction)
        : [],
    };
  } catch {
    return null;
  }
}

export function saveWalletLedger(ledger: WalletLedger): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ledgerStorageKey(ledger.accountId), JSON.stringify(ledger));
  } catch {
    // The in-memory React state remains authoritative if storage is unavailable.
  }
}

export function ensureWalletLedger(accountId: string): WalletLedger {
  const existingLedger = loadWalletLedger(accountId);
  if (existingLedger) return existingLedger;

  const ledger = createWalletLedger(accountId);
  saveWalletLedger(ledger);
  return ledger;
}

export function createQueryDebit(
  ledger: WalletLedger,
  amountNear: number,
  vaultTitle: string,
): { ledger: WalletLedger; transaction: WalletTransaction } | null {
  const amount = roundNear(amountNear);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (ledger.balanceNear + 1e-9 < amount) return null;

  const transaction: WalletTransaction = {
    id: `tx-query-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: "QUERY_DEBIT",
    amount: `-${amount.toFixed(2)} NEAR`,
    description: `Query fee for ${vaultTitle}`,
    recipient: "Publisher Vault",
    status: "CONFIRMED",
    timestamp: "Just now",
  };

  return {
    transaction,
    ledger: {
      ...ledger,
      balanceNear: roundNear(ledger.balanceNear - amount),
      transactions: [transaction, ...ledger.transactions],
    },
  };
}

