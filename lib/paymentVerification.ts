import {
  NEAR_TESTNET_RPC_URL,
  PAYMENT_MAX_AGE_MS,
  getTreasuryAccount,
  yoctoToNearAmount,
} from "@/lib/paymentConfig";

/**
 * Server-side verification of a real NEAR testnet query payment.
 *
 * The client signs a native NEAR transfer to the BlindSight treasury account.
 * The server then fetches the finalized transaction from the public NEAR RPC
 * and checks the signer, receiver, transfer amount, and execution status before
 * any inference runs. Nothing here trusts data supplied by the client except
 * the transaction hash and the claimed payer account (both are checked against
 * the on-chain transaction).
 */

export type VerifiedNearPayment = {
  network: "testnet";
  txHash: string;
  payerAccountId: string;
  receiverId: string;
  amountYocto: string;
  amountNear: string;
  blockHash: string | null;
  blockHeight: number | null;
  verifiedAt: string;
};

export type VerifyNearTransferArgs = {
  txHash: string;
  payerAccountId: string;
  /** Defaults to the configured treasury account. */
  expectedReceiver?: string;
  /** The transfer must cover at least this many yoctoNEAR. */
  minimumYocto: bigint;
};

export class PaymentVerificationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 402) {
    super(message);
    this.name = "PaymentVerificationError";
    this.code = code;
    this.status = status;
  }
}

type RpcError = {
  cause?: { name?: string; info?: unknown };
  data?: unknown;
  message?: string;
};

type TxAction = Record<string, unknown>;

type TransactionOutcome = {
  final_execution_status?: string;
  transaction?: {
    signer_id?: string;
    receiver_id?: string;
    hash?: string;
    actions?: TxAction[];
  };
  transaction_outcome?: {
    block_hash?: string;
    outcome?: { block_hash?: string };
  };
  status?: {
    SuccessValue?: string;
    SuccessReceiptId?: string;
    Failure?: unknown;
  };
};

type BlockResult = {
  header?: { height?: number; timestamp?: number | string };
};

class RpcLookupError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RpcLookupError";
    this.code = code;
  }
}

let rpcId = 0;

async function nearRpc<T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 8_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(NEAR_TESTNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `blindsight-${++rpcId}`,
        method,
        params,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new RpcLookupError("RPC_HTTP_ERROR", `NEAR RPC returned HTTP ${response.status}.`);
    }

    const payload = await response.json() as { result?: T; error?: RpcError };
    if (payload.error) {
      const code = String(
        payload.error.cause?.name
        ?? payload.error.data
        ?? "RPC_ERROR",
      );
      throw new RpcLookupError(code, payload.error.message ?? "NEAR RPC request failed.");
    }
    if (payload.result === undefined) {
      throw new RpcLookupError("EMPTY_RESULT", "NEAR RPC returned an empty result.");
    }
    return payload.result;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new RpcLookupError("TIMEOUT_ERROR", "NEAR RPC timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const RETRYABLE_RPC_CODES = new Set([
  "UNKNOWN_TRANSACTION",
  "UNKNOWN_BLOCK",
  "TIMEOUT_ERROR",
  "NOT_SYNCED",
  "EMPTY_RESULT",
]);

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function validateTransactionHash(txHash: string): string {
  const trimmed = txHash.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(trimmed)) {
    throw new PaymentVerificationError(
      "The supplied transaction hash is not a valid NEAR transaction hash.",
      "INVALID_TX_HASH",
      400,
    );
  }
  return trimmed;
}

function validateAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(trimmed)) {
    throw new PaymentVerificationError(
      "The supplied payer account ID is not a valid NEAR testnet account.",
      "INVALID_PAYER",
      400,
    );
  }
  return trimmed;
}

function extractTransferDeposit(action: TxAction): bigint | null {
  const transfer = action.Transfer;
  if (!transfer || typeof transfer !== "object") return null;
  const deposit = (transfer as { deposit?: unknown }).deposit;
  if (typeof deposit !== "string" && typeof deposit !== "number") return null;
  try {
    return BigInt(deposit);
  } catch {
    return null;
  }
}

function timestampToMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // NEAR block timestamps are nanoseconds; tolerate milliseconds too.
    return value > 1e15 ? Math.round(value / 1e6) : Math.round(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const raw = BigInt(value);
    return Number(raw > BigInt(1e15) ? raw / BigInt(1_000_000) : raw);
  }
  return null;
}

export async function verifyNearTransfer(
  args: VerifyNearTransferArgs,
): Promise<VerifiedNearPayment> {
  const txHash = validateTransactionHash(args.txHash);
  const payerAccountId = validateAccountId(args.payerAccountId);
  const expectedReceiver = args.expectedReceiver ?? getTreasuryAccount();

  if (args.minimumYocto <= BigInt(0)) {
    throw new PaymentVerificationError(
      "The expected query price must be greater than zero.",
      "INVALID_PRICE",
      400,
    );
  }

  let outcome: TransactionOutcome | null = null;
  let lastError: unknown = null;
  const maxAttempts = 3;

  // The wallet has already returned the signed transaction, so the lookup
  // normally succeeds on the first try. Keep the backoff short so a briefly
  // lagging RPC does not add seconds to the paid-answer path.
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      outcome = await nearRpc<TransactionOutcome>("tx", {
        tx_hash: txHash,
        sender_account_id: payerAccountId,
        wait_until: "EXECUTED_OPTIMISTIC",
      });
      break;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof RpcLookupError && RETRYABLE_RPC_CODES.has(error.code);
      if (!retryable || attempt === maxAttempts - 1) break;
      await delay(350 + attempt * 450);
    }
  }

  if (!outcome) {
    if (lastError instanceof RpcLookupError && !RETRYABLE_RPC_CODES.has(lastError.code)) {
      throw new PaymentVerificationError(
        "NEAR RPC could not verify the payment right now. Please retry in a moment.",
        "RPC_UNAVAILABLE",
        502,
      );
    }
    throw new PaymentVerificationError(
      "The payment transaction is not visible on NEAR testnet yet. Wait a few seconds and try again.",
      "TX_NOT_FOUND",
      402,
    );
  }

  const transaction = outcome.transaction;
  if (!transaction) {
    throw new PaymentVerificationError(
      "NEAR RPC returned an incomplete transaction.",
      "TX_INCOMPLETE",
      502,
    );
  }

  if (!outcome.status || (!("SuccessValue" in outcome.status) && !("SuccessReceiptId" in outcome.status))) {
    throw new PaymentVerificationError(
      "The payment transaction failed on-chain. No fee was received.",
      "TX_FAILED",
      402,
    );
  }

  const signer = String(transaction.signer_id ?? "");
  if (signer !== payerAccountId) {
    throw new PaymentVerificationError(
      "The connected wallet did not sign this payment transaction.",
      "WRONG_PAYER",
      402,
    );
  }

  const receiver = String(transaction.receiver_id ?? "");
  if (receiver !== expectedReceiver) {
    throw new PaymentVerificationError(
      `This payment was sent to ${receiver || "an unknown account"}, not the BlindSight treasury.`,
      "WRONG_RECEIVER",
      402,
    );
  }

  const actions = Array.isArray(transaction.actions) ? transaction.actions : [];
  const deposited = actions.reduce((total, action) => {
    const deposit = extractTransferDeposit(action);
    return deposit === null ? total : total + deposit;
  }, BigInt(0));

  if (deposited <= BigInt(0)) {
    throw new PaymentVerificationError(
      "The transaction does not contain a native NEAR transfer.",
      "NO_TRANSFER",
      402,
    );
  }

  if (deposited < args.minimumYocto) {
    throw new PaymentVerificationError(
      `The payment was ${yoctoToNearAmount(deposited)} NEAR but this query costs ${yoctoToNearAmount(args.minimumYocto)} NEAR.`,
      "UNDERPAID",
      402,
    );
  }

  const blockHash = outcome.transaction_outcome?.block_hash
    ?? outcome.transaction_outcome?.outcome?.block_hash
    ?? null;
  let blockHeight: number | null = null;

  if (blockHash) {
    try {
      const block = await nearRpc<BlockResult>("block", { block_id: blockHash }, 5_000);
      blockHeight = typeof block.header?.height === "number" ? block.header.height : null;
      const blockTimeMs = timestampToMs(block.header?.timestamp);
      if (blockTimeMs !== null && Date.now() - blockTimeMs > PAYMENT_MAX_AGE_MS) {
        throw new PaymentVerificationError(
          "This payment is too old to use. Please make a new payment.",
          "STALE_PAYMENT",
          402,
        );
      }
    } catch (error) {
      if (error instanceof PaymentVerificationError) throw error;
      // A block lookup failure must not reject a transaction that the RPC has
      // already reported as executed and successful.
    }
  }

  return {
    network: "testnet",
    txHash,
    payerAccountId,
    receiverId: receiver,
    amountYocto: deposited.toString(),
    amountNear: yoctoToNearAmount(deposited),
    blockHash,
    blockHeight,
    verifiedAt: new Date().toISOString(),
  };
}
