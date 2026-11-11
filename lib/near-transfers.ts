import { actions, parseNearAmount, type Action } from "near-api-js";
import { isValidNearAccountId } from "@/lib/nearAccount";

/**
 * Real NEAR testnet transfer helpers.
 *
 * `near-api-js` v7 no longer exposes the legacy `utils`, `WalletConnection`,
 * `Near`, or `connect` helpers. The equivalent v7 primitives are used here:
 * `parseNearAmount`, `Account.transfer` / `sendMoney`, and the low-level
 * `signAndSendTransaction` action list.
 *
 * There is no mock transfer path in this module: every successful call has
 * been signed in the user's wallet and submitted to NEAR testnet.
 */

type TransactionResponse = unknown;

/**
 * The subset of a near-api-js account used by this module. Both v7 `Account`
 * instances and legacy `WalletConnection.account()` results are accepted.
 */
export type NearAccountLike = {
  accountId?: string;
  sendMoney?: (receiverId: string, amount: string) => Promise<TransactionResponse>;
  transfer?: (args: {
    receiverId: string;
    amount: bigint | string | number;
  }) => Promise<TransactionResponse>;
  signAndSendTransaction?: (args: {
    receiverId: string;
    actions: Action[];
    waitUntil?: "NONE" | "INCLUDED" | "EXECUTED" | "INCLUDED_FINAL" | "FINAL";
    throwOnFailure?: boolean;
  }) => Promise<TransactionResponse>;
};

/**
 * Accepts an account directly or a `WalletConnection`-style wrapper exposing
 * `account()` / `getAccount()`.
 */
export type WalletConnectionLike =
  | NearAccountLike
  | { account: () => NearAccountLike }
  | { getAccount: () => NearAccountLike }
  | WalletSelectorContextLike;

/**
 * The Wallet Selector wallet surface used for signing. Calling
 * `signAndSendTransaction` opens the wallet's approval popup.
 */
type WalletSelectorWalletLike = {
  signAndSendTransaction: (args: {
    receiverId: string;
    actions: never;
  }) => Promise<TransactionResponse>;
  signAndSendTransactions?: (args: {
    transactions: { receiverId: string; actions: never }[];
  }) => Promise<unknown>;
};

/**
 * The app's `WalletContext` value (`components/WalletProvider.tsx`): an
 * account ID plus the active Wallet Selector wallet.
 */
export type WalletSelectorContextLike = {
  accountId: string | null;
  wallet: WalletSelectorWalletLike | null;
};

function isWalletSelectorContext(value: unknown): value is WalletSelectorContextLike {
  return typeof value === "object"
    && value !== null
    && "wallet" in value
    && "accountId" in value;
}

/**
 * Extracts the transaction hash from a NEAR `FinalExecutionOutcome`.
 * Returns `undefined` when the wallet did not return an outcome (for example a
 * redirect-based wallet that navigates away before resolving).
 */
export function extractTransactionHash(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const outcome = result as {
    transaction_outcome?: { id?: unknown };
    transaction?: { hash?: unknown };
  };
  if (typeof outcome.transaction_outcome?.id === "string") return outcome.transaction_outcome.id;
  if (typeof outcome.transaction?.hash === "string") return outcome.transaction.hash;
  return undefined;
}

function resolveAccount(walletConnection: WalletConnectionLike): NearAccountLike {
  if (!walletConnection || typeof walletConnection !== "object") {
    throw new Error("A connected NEAR wallet is required.");
  }

  // Wallet Selector context: route signing through the wallet so the user
  // approves the transaction in the wallet popup.
  if (isWalletSelectorContext(walletConnection)) {
    const { wallet, accountId } = walletConnection;
    if (!wallet || !accountId) {
      throw new Error("Connect a NEAR wallet to sign the on-chain payment.");
    }
    return {
      accountId,
      signAndSendTransaction: ({ receiverId, actions: txActions }) =>
        wallet.signAndSendTransaction({
          receiverId,
          // Wallet Selector and near-api-js expose structurally identical
          // @near-js action objects from separate package bundles.
          actions: txActions as never,
        }),
    };
  }

  const candidate = walletConnection as {
    account?: () => NearAccountLike;
    getAccount?: () => NearAccountLike;
  };

  if (typeof candidate.account === "function") {
    return candidate.account();
  }

  if (typeof candidate.getAccount === "function") {
    return candidate.getAccount();
  }

  return walletConnection as NearAccountLike;
}

/**
 * Sends native NEAR from the connected wallet.
 *
 * `amountInNear` is a human-readable amount such as `"0.5"`. The v7
 * `parseNearAmount` replaces the removed `utils.format.parseNearAmount`.
 */
export async function transferNear(
  walletConnection: WalletConnectionLike,
  receiverId: string,
  amountInNear: string,
): Promise<TransactionResponse> {
  const receiver = receiverId.trim();
  if (!isValidNearAccountId(receiver)) {
    throw new Error("The receiver is not a valid NEAR testnet account ID.");
  }

  const amountInYocto = parseNearAmount(amountInNear as `${number}`);
  if (!amountInYocto) {
    throw new Error("The NEAR amount is invalid.");
  }

  const amount = BigInt(amountInYocto);
  if (amount <= BigInt(0)) {
    throw new Error("The NEAR amount must be greater than zero.");
  }

  const account = resolveAccount(walletConnection);

  // Legacy WalletConnection-era accounts expose `sendMoney(receiverId, amount)`.
  if (typeof account.sendMoney === "function") {
    return account.sendMoney(receiver, amountInYocto);
  }

  // near-api-js v7 `Account.transfer` handles native NEAR when no token is set.
  if (typeof account.transfer === "function") {
    return account.transfer({ receiverId: receiver, amount });
  }

  // Fall back to the low-level transaction API if only that is available.
  if (typeof account.signAndSendTransaction === "function") {
    return account.signAndSendTransaction({
      receiverId: receiver,
      actions: [actions.transfer(amount)],
    });
  }

  throw new Error("The connected wallet account cannot send NEAR transfers.");
}

export type NearTransferRequest = {
  receiverId: string;
  amountNear: string;
};

function toTransferAction(amountNear: string): Action {
  const amountInYocto = parseNearAmount(amountNear as `${number}`);
  if (!amountInYocto || BigInt(amountInYocto) <= BigInt(0)) {
    throw new Error("The NEAR amount is invalid.");
  }
  return actions.transfer(BigInt(amountInYocto));
}

/**
 * Sends several native NEAR transfers, e.g. a vault price to its publisher and
 * a platform fee to the treasury. Wallets that support batching approve them
 * all in one prompt; others fall back to one prompt per transfer.
 *
 * Returns the transaction hashes in the same order as `transfers`.
 */
export async function transferNearBatch(
  walletContext: WalletSelectorContextLike,
  transfers: NearTransferRequest[],
): Promise<string[]> {
  const { wallet, accountId } = walletContext;
  if (!wallet || !accountId) {
    throw new Error("Connect a NEAR wallet to sign the on-chain payment.");
  }
  for (const transfer of transfers) {
    if (!isValidNearAccountId(transfer.receiverId.trim())) {
      throw new Error("The receiver is not a valid NEAR testnet account ID.");
    }
  }

  if (transfers.length > 1 && typeof wallet.signAndSendTransactions === "function") {
    const outcomes = await wallet.signAndSendTransactions({
      transactions: transfers.map((transfer) => ({
        receiverId: transfer.receiverId.trim(),
        // Same structural cast as resolveAccount(): separate @near-js bundles.
        actions: [toTransferAction(transfer.amountNear)] as never,
      })),
    });
    const hashes = Array.isArray(outcomes) ? outcomes.map(extractTransactionHash) : [];
    if (hashes.length !== transfers.length || hashes.some((hash) => !hash)) {
      throw new Error("The wallet did not return every transaction. Check your wallet activity.");
    }
    return hashes as string[];
  }

  const hashes: string[] = [];
  for (const transfer of transfers) {
    const result = await transferNear(walletContext, transfer.receiverId, transfer.amountNear);
    const hash = extractTransactionHash(result);
    if (!hash) throw new Error("The wallet did not return a transaction. Check your wallet activity.");
    hashes.push(hash);
  }
  return hashes;
}
