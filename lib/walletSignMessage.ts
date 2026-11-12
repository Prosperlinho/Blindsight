/**
 * Robust NEP-413 message signing across Wallet Selector wallets.
 *
 * Wallet Selector's MyNearWallet adapter only understands one popup reply
 * shape; when the wallet answers differently (flat fields, or by redirecting
 * the popup to the callback URL) the adapter yields an empty signature or a
 * "User closed the window" error. This helper also listens for those replies.
 * The server verifies every signature, so accepting either path is safe.
 *
 * Browser-only.
 */
import type { SignMessageParams, Wallet } from "@near-wallet-selector/core";

export type WalletSignature = { accountId: string; publicKey: string; signature: string };

export const WALLET_CALLBACK_PATH = "/wallet-callback";
export const WALLET_CALLBACK_SOURCE = "blindsight-wallet-callback";

const WALLET_ORIGINS = new Set(["https://testnet.mynearwallet.com", "https://app.mynearwallet.com"]);
/** Grace period for a popup reply to arrive after the adapter settles. */
const LATE_REPLY_MS = 1_500;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Extracts a signature from any of the reply shapes wallets use. */
export function pickWalletSignature(data: unknown): WalletSignature | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const inner = (record.signedRequest && typeof record.signedRequest === "object"
    ? record.signedRequest
    : record) as Record<string, unknown>;
  const signature = text(inner.signature);
  const publicKey = text(inner.publicKey) || text(inner.public_key);
  const accountId = text(inner.accountId) || text(inner.account_id);
  return signature && publicKey ? { accountId, publicKey, signature } : null;
}

/** Reads a redirect-style wallet reply from a URL's hash and query string. */
export function parseWalletCallback(url: URL): { signed: WalletSignature | null; error: string } {
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));
  url.searchParams.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  const signed = pickWalletSignature(Object.fromEntries(params));
  const error = params.get("error") || params.get("errorMessage") || params.get("errorCode") || "";
  return { signed, error };
}

export function isUserCancellation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /closed the window|user (rejected|cancel|denied)|rejected by user|cancel/i.test(message);
}

export function signMessageWithWallet(
  wallet: Wallet,
  params: Omit<SignMessageParams, "callbackUrl">,
): Promise<WalletSignature> {
  if (typeof wallet.signMessage !== "function") {
    return Promise.reject(new Error("This wallet can't sign messages."));
  }
  const signMessage = wallet.signMessage.bind(wallet);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      settle();
    };

    function onMessage(event: MessageEvent) {
      const fromCallback = event.origin === window.location.origin
        && (event.data as { source?: unknown } | null)?.source === WALLET_CALLBACK_SOURCE;
      if (!fromCallback && !WALLET_ORIGINS.has(event.origin)) return;

      const signed = pickWalletSignature(event.data);
      if (signed) {
        finish(() => resolve(signed));
        return;
      }
      const error = text((event.data as { error?: unknown; errorMessage?: unknown } | null)?.error)
        || text((event.data as { errorMessage?: unknown } | null)?.errorMessage);
      if (fromCallback && error) finish(() => reject(new Error(error)));
    }

    window.addEventListener("message", onMessage);

    signMessage({ ...params, callbackUrl: `${window.location.origin}${WALLET_CALLBACK_PATH}` }).then(
      (result) => {
        const signed = pickWalletSignature(result);
        if (signed) {
          finish(() => resolve(signed));
          return;
        }
        window.setTimeout(() => finish(() => reject(new Error("The wallet didn't return a signature."))), LATE_REPLY_MS);
      },
      (error: unknown) => {
        window.setTimeout(
          () => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
          LATE_REPLY_MS,
        );
      },
    );
  });
}
