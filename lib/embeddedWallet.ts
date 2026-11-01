import { KeyPair, keyToImplicitAddress, type KeyPairString } from "near-api-js";

const PRIVATE_KEY_STORAGE_KEY = "blindsight_private_key";
const ACCOUNT_ID_STORAGE_KEY = "blindsight_account_id";
const ACCOUNTS_LEDGER_STORAGE_KEY = "blindsight_accounts_ledger";
export const ACCOUNTS_LEDGER_EVENT = "blindsight:accounts-ledger-updated";

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

export type WalletTransactionType =
  | "FAUCET_CREDIT"
  | "DEPOSIT_CREDIT"
  | "QUERY_DEBIT"
  | "WITHDRAWAL_DEBIT";
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

export type AccountsLedger = Record<string, WalletLedger>;

export type NearTransferReceipt = {
  senderLedger: WalletLedger;
  recipientLedger: WalletLedger;
  senderTransaction: WalletTransaction;
  recipientTransaction: WalletTransaction;
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

export function normalizeAccountAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function getAccountLedger(accounts: AccountsLedger, address: string): WalletLedger | null {
  return accounts[normalizeAccountAddress(address)] ?? null;
}

export function getAccountBalance(accounts: AccountsLedger, address: string): number {
  return getAccountLedger(accounts, address)?.balanceNear ?? 0;
}

export function loadAccountsLedger(): AccountsLedger {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawLedger = window.localStorage.getItem(ACCOUNTS_LEDGER_STORAGE_KEY);
    if (!rawLedger) return {};

    const parsed = JSON.parse(rawLedger) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const accounts: AccountsLedger = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const ledger = value as Partial<WalletLedger>;
      if (typeof ledger.accountId !== "string" || typeof ledger.balanceNear !== "number") continue;
      const normalizedKey = normalizeAccountAddress(key);
      if (!normalizedKey) continue;
      accounts[normalizedKey] = {
        accountId: ledger.accountId,
        address: typeof ledger.address === "string" && ledger.address
          ? ledger.address
          : formatNearAddress(ledger.accountId),
        balanceNear: Math.max(0, roundNear(ledger.balanceNear)),
        transactions: Array.isArray(ledger.transactions)
          ? ledger.transactions.filter(isWalletTransaction)
          : [],
      };
    }
    return accounts;
  } catch {
    return {};
  }
}

export function saveAccountsLedger(accounts: AccountsLedger, notify = false): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ACCOUNTS_LEDGER_STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // The in-memory React state remains authoritative if storage is unavailable.
  }

  if (notify) {
    window.dispatchEvent(new Event(ACCOUNTS_LEDGER_EVENT));
  }
}

export function seedAccountEarnings(
  accounts: AccountsLedger,
  address: string,
  earningsNear: number,
): { accounts: AccountsLedger; ledger: WalletLedger; changed: boolean } {
  const key = normalizeAccountAddress(address);
  const existing = accounts[key];
  if (existing) {
    return { accounts, ledger: existing, changed: false };
  }

  const baseLedger = createWalletLedger(address);
  const earnings = Math.max(0, roundNear(earningsNear));
  const ledger: WalletLedger = {
    ...baseLedger,
    balanceNear: roundNear(baseLedger.balanceNear + earnings),
    transactions: earnings > 0
      ? [
          {
            id: `tx-earnings-${key}`,
            type: "DEPOSIT_CREDIT",
            amount: `+${earnings.toFixed(2)} NEAR`,
            description: "Historical vault revenue",
            status: "SUCCESS",
            timestamp: "Recorded",
          },
          ...baseLedger.transactions,
        ]
      : baseLedger.transactions,
  };

  accounts[key] = ledger;
  return { accounts, ledger, changed: true };
}

function isWalletTransaction(value: unknown): value is WalletTransaction {
  if (!value || typeof value !== "object") return false;
  const transaction = value as Partial<WalletTransaction>;
  return typeof transaction.id === "string"
    && (
      transaction.type === "FAUCET_CREDIT"
      || transaction.type === "DEPOSIT_CREDIT"
      || transaction.type === "QUERY_DEBIT"
      || transaction.type === "WITHDRAWAL_DEBIT"
    )
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

  const accounts = loadAccountsLedger();
  accounts[normalizeAccountAddress(ledger.accountId)] = ledger;
  saveAccountsLedger(accounts);
}

export function ensureWalletLedger(accountId: string): WalletLedger {
  if (typeof window === "undefined") {
    return createWalletLedger(accountId);
  }

  const accounts = loadAccountsLedger();
  const key = normalizeAccountAddress(accountId);
  const accountLedger = accounts[key];
  if (accountLedger) {
    return {
      ...accountLedger,
      accountId,
      address: formatNearAddress(accountId),
    };
  }

  const existingLedger = loadWalletLedger(accountId);
  const ledger = existingLedger ?? createWalletLedger(accountId);
  accounts[key] = ledger;
  saveAccountsLedger(accounts);
  try {
    window.localStorage.setItem(ledgerStorageKey(accountId), JSON.stringify(ledger));
  } catch {
    // The in-memory React state remains authoritative if storage is unavailable.
  }
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

export function createDeposit(
  ledger: WalletLedger,
  amountNear: number,
): { ledger: WalletLedger; transaction: WalletTransaction } | null {
  const amount = roundNear(amountNear);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const transaction: WalletTransaction = {
    id: `tx-deposit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: "DEPOSIT_CREDIT",
    amount: `+${amount.toFixed(2)} NEAR`,
    description: "Testnet faucet top-up",
    status: "SUCCESS",
    timestamp: "Just now",
  };

  return {
    transaction,
    ledger: {
      ...ledger,
      balanceNear: roundNear(ledger.balanceNear + amount),
      transactions: [transaction, ...ledger.transactions],
    },
  };
}

type TransferTransactionFactory = (context: {
  amount: number;
  senderDisplay: string;
  recipientDisplay: string;
}) => { sender: WalletTransaction; recipient: WalletTransaction };

function persistWalletLedgerSnapshot(ledger: WalletLedger): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ledgerStorageKey(ledger.accountId), JSON.stringify(ledger));
  } catch {
    // The global accounts ledger remains the source of truth if storage is unavailable.
  }
}

function executeAccountTransfer(
  senderLedger: WalletLedger,
  recipientAddress: string,
  amountNear: number,
  createTransactions: TransferTransactionFactory,
): NearTransferReceipt | null {
  if (typeof window === "undefined") return null;

  const amount = roundNear(amountNear);
  const destination = recipientAddress.trim();
  if (!destination || !Number.isFinite(amount) || amount <= 0) return null;

  const senderKey = normalizeAccountAddress(senderLedger.accountId);
  const recipientKey = normalizeAccountAddress(destination);
  if (!senderKey || !recipientKey || senderKey === recipientKey) return null;

  const accounts = loadAccountsLedger();
  const senderBase = accounts[senderKey] ?? senderLedger;
  if (senderBase.balanceNear + 1e-9 < amount) return null;

  const recipientBase = accounts[recipientKey] ?? createWalletLedger(destination);
  const senderDisplay = senderBase.address || formatNearAddress(senderLedger.accountId);
  const recipientDisplay = recipientBase.address || formatNearAddress(destination);
  const { sender: senderTransaction, recipient: recipientTransaction } = createTransactions({
    amount,
    senderDisplay,
    recipientDisplay,
  });

  const senderNext: WalletLedger = {
    ...senderBase,
    accountId: senderLedger.accountId,
    address: formatNearAddress(senderLedger.accountId),
    balanceNear: roundNear(senderBase.balanceNear - amount),
    transactions: [senderTransaction, ...senderBase.transactions],
  };
  const recipientNext: WalletLedger = {
    ...recipientBase,
    accountId: recipientBase.accountId || destination,
    address: recipientDisplay,
    balanceNear: roundNear(recipientBase.balanceNear + amount),
    transactions: [recipientTransaction, ...recipientBase.transactions],
  };

  accounts[senderKey] = senderNext;
  accounts[recipientKey] = recipientNext;
  saveAccountsLedger(accounts, true);
  persistWalletLedgerSnapshot(senderNext);
  persistWalletLedgerSnapshot(recipientNext);

  return {
    senderLedger: senderNext,
    recipientLedger: recipientNext,
    senderTransaction,
    recipientTransaction,
  };
}

export function sendNear(
  senderLedger: WalletLedger,
  recipientAddress: string,
  amountNear: number,
): NearTransferReceipt | null {
  return executeAccountTransfer(senderLedger, recipientAddress, amountNear, ({ amount, senderDisplay, recipientDisplay }) => ({
    sender: {
      id: `tx-withdraw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "WITHDRAWAL_DEBIT",
      amount: `-${amount.toFixed(2)} NEAR`,
      description: `Transferred to ${recipientDisplay}`,
      recipient: recipientDisplay,
      status: "CONFIRMED",
      timestamp: "Just now",
    },
    recipient: {
      id: `tx-deposit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "DEPOSIT_CREDIT",
      amount: `+${amount.toFixed(2)} NEAR`,
      description: `Received from ${senderDisplay}`,
      recipient: senderDisplay,
      status: "SUCCESS",
      timestamp: "Just now",
    },
  }));
}

export function settleQueryPayment(
  senderLedger: WalletLedger,
  amountNear: number,
  vaultTitle: string,
  publisherAddress: string,
): NearTransferReceipt | null {
  return executeAccountTransfer(senderLedger, publisherAddress, amountNear, ({ amount, senderDisplay, recipientDisplay }) => ({
    sender: {
      id: `tx-query-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "WITHDRAWAL_DEBIT",
      amount: `-${amount.toFixed(2)} NEAR`,
      description: `Query fee for ${vaultTitle}`,
      recipient: recipientDisplay,
      status: "CONFIRMED",
      timestamp: "Just now",
    },
    recipient: {
      id: `tx-deposit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "DEPOSIT_CREDIT",
      amount: `+${amount.toFixed(2)} NEAR`,
      description: `Query payout for ${vaultTitle}`,
      recipient: senderDisplay,
      status: "SUCCESS",
      timestamp: "Just now",
    },
  }));
}

export function createWithdrawal(
  ledger: WalletLedger,
  amountNear: number,
  recipient: string,
): { ledger: WalletLedger; transaction: WalletTransaction } | null {
  const transfer = sendNear(ledger, recipient, amountNear);
  if (!transfer) return null;
  return { ledger: transfer.senderLedger, transaction: transfer.senderTransaction };
}

