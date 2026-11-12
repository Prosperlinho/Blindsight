"use client";

import { useEffect, useState } from "react";
import { parseWalletCallback, WALLET_CALLBACK_SOURCE } from "@/lib/walletSignMessage";

/**
 * Landing page for wallets that answer a sign-message request by redirecting
 * their popup here. It hands the result back to the BlindSight tab and closes.
 */
export default function WalletCallbackPage() {
  const [status, setStatus] = useState("Returning to BlindSight…");

  useEffect(() => {
    const { signed, error } = parseWalletCallback(new URL(window.location.href));
    const opener = window.opener as Window | null;

    if (opener && !opener.closed) {
      opener.postMessage(
        { source: WALLET_CALLBACK_SOURCE, ...(signed ?? {}), error: signed ? "" : error || "The wallet didn't return a signature." },
        window.location.origin,
      );
      window.setTimeout(() => window.close(), 300);
      return;
    }
    const id = window.setTimeout(() => setStatus("You can close this window and return to BlindSight."), 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-[#05070d] px-6 text-center text-sm text-slate-300">
      <p>{status}</p>
    </main>
  );
}
