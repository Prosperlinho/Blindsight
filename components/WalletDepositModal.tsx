"use client";

import { useEffect, useRef, useState } from "react";
import { formatNearAmount, type QuerySettlementResult, type WalletLedger } from "@/lib/embeddedWallet";

type WalletDepositModalProps = {
  ledger: WalletLedger;
  onClose: () => void;
  onDeposit: (amountNear: number) => QuerySettlementResult;
};

const FAUCET_TOP_UP_NEAR = 1;

export default function WalletDepositModal({ ledger, onClose, onDeposit }: WalletDepositModalProps) {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText(ledger.address);
      setCopied(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, 1800);
    } catch {
      setError("Could not copy the address. Select it manually instead.");
    }
  }

  function handleTopUp() {
    const result = onDeposit(FAUCET_TOP_UP_NEAR);
    if (!result.success) {
      setError(result.message ?? "The top-up could not be completed.");
      setNotice("");
      return;
    }
    setError("");
    setNotice(`Added ${formatNearAmount(FAUCET_TOP_UP_NEAR)} to your balance.`);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-near-title"
        className="relative w-full max-w-[460px] rounded-xl border border-emerald-500/20 bg-[#0B0F17]/95 p-5 shadow-[0_24px_100px_rgba(0,0,0,0.65)] sm:p-6"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close deposit dialog"
          className="absolute right-4 top-4 grid size-8 place-items-center border border-emerald-500/20 text-[#A7B9B0] transition hover:border-[#34D399] hover:text-[#F0FDF4]"
        >
          ×
        </button>
        <h2 id="deposit-near-title" className="pr-10 font-serif text-xl font-medium text-[#F0FDF4]">
          Deposit NEAR
        </h2>
        <p className="mt-2 text-xs leading-5 text-[#A7B9B0]">
          Top up your testnet balance to keep querying private vaults.
        </p>

        <div className="mt-5 border border-emerald-500/20 bg-[#0B0F17]/70 p-3">
          <div className="text-[9px] uppercase tracking-[0.14em] text-[#7D9187]">Your Blindsight address</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 break-all font-mono text-[11px] text-[#34D399]">{ledger.address}</code>
            <button
              type="button"
              onClick={() => void handleCopyAddress()}
              aria-label={`Copy wallet address ${ledger.address}`}
              className="shrink-0 border border-emerald-500/20 px-2 py-1 text-[9px] text-[#A7B9B0] transition hover:border-emerald-500/40 hover:text-[#34D399]"
            >
              {copied ? "Copied" : "Copy Address"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border border-emerald-500/20 bg-emerald-950/20 px-3 py-2.5">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#7D9187]">Current balance</span>
          <span className="font-mono text-[14px] text-[#F0FDF4]">{formatNearAmount(ledger.balanceNear)}</span>
        </div>

        <button
          type="button"
          onClick={handleTopUp}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 bg-emerald-500 text-[12px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
        >
          Top-Up +1.0 NEAR (Faucet)
        </button>

        {notice && (
          <div role="status" className="mt-3 border border-emerald-500/25 bg-emerald-950/40 px-3 py-2 text-[11px] text-[#D1FAE5]">
            {notice} New balance: {formatNearAmount(ledger.balanceNear)}.
          </div>
        )}
        {error && (
          <div role="alert" className="mt-3 border border-[#FCA5A5]/25 bg-[#261719] px-3 py-2 text-[11px] text-[#FCA5A5]">
            {error}
          </div>
        )}
      </section>
    </div>
  );
}
