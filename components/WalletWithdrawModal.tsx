"use client";

import { useState, type FormEvent } from "react";
import { formatNearAmount, roundNear, type QuerySettlementResult, type WalletLedger } from "@/lib/embeddedWallet";

type WalletWithdrawModalProps = {
  ledger: WalletLedger;
  onClose: () => void;
  onWithdraw: (recipient: string, amountNear: number) => QuerySettlementResult;
};

export default function WalletWithdrawModal({ ledger, onClose, onWithdraw }: WalletWithdrawModalProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const parsedAmount = Number(amount);
  const amountIsEntered = amount.trim().length > 0;
  const amountIsValid = amountIsEntered && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const amountExceedsBalance = amountIsValid && roundNear(parsedAmount) > ledger.balanceNear + 1e-9;
  const canSubmit = recipient.trim().length > 0 && amountIsValid && !amountExceedsBalance;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipient.trim()) {
      setError("Enter a recipient NEAR address.");
      return;
    }
    if (!amountIsValid) {
      setError("Enter an amount greater than 0.");
      return;
    }
    if (amountExceedsBalance) {
      setError(`Amount exceeds your available balance of ${formatNearAmount(ledger.balanceNear)}.`);
      return;
    }

    const result = onWithdraw(recipient.trim(), parsedAmount);
    if (!result.success) {
      setError(result.message ?? "The transfer could not be completed.");
      return;
    }
    onClose();
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
        aria-labelledby="withdraw-near-title"
        className="relative w-full max-w-[460px] rounded-xl border border-emerald-500/20 bg-[#0B0F17]/95 p-5 shadow-[0_24px_100px_rgba(0,0,0,0.65)] sm:p-6"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close withdraw dialog"
          className="absolute right-4 top-4 grid size-8 place-items-center border border-emerald-500/20 text-[#A7B9B0] transition hover:border-[#34D399] hover:text-[#F0FDF4]"
        >
          ×
        </button>
        <h2 id="withdraw-near-title" className="pr-10 font-serif text-xl font-medium text-[#F0FDF4]">
          Withdraw / Send
        </h2>
        <p className="mt-2 text-xs leading-5 text-[#A7B9B0]">
          Send testnet NEAR from your Blindsight wallet to another address.
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 border border-emerald-500/20 bg-emerald-950/20 px-3 py-2.5">
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#7D9187]">Available balance</span>
          <span className="font-mono text-[14px] text-[#F0FDF4]">{formatNearAmount(ledger.balanceNear)}</span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] text-[#A7B9B0]">Recipient NEAR address</span>
            <input
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
                setError("");
              }}
              placeholder="recipient.testnet"
              autoComplete="off"
              className="h-10 w-full border border-emerald-500/20 bg-[#0B0F17]/80 px-3 font-mono text-[12px] text-[#E2F8EC] outline-none transition placeholder:text-[#7D9187] focus:border-[#10B981]/60"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-[#A7B9B0]">
              <span>Amount</span>
              <button
                type="button"
                onClick={() => {
                  setAmount(ledger.balanceNear.toFixed(2));
                  setError("");
                }}
                className="text-[9px] uppercase tracking-[0.12em] text-[#34D399] transition hover:text-emerald-300"
              >
                Use max
              </button>
            </span>
            <span className="relative block">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError("");
                }}
                placeholder="1.00"
                className="h-10 w-full border border-emerald-500/20 bg-[#0B0F17]/80 px-3 pr-14 font-mono text-[12px] text-[#E2F8EC] outline-none transition placeholder:text-[#7D9187] focus:border-[#10B981]/60"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#7D9187]">
                NEAR
              </span>
            </span>
            {amountExceedsBalance && (
              <span role="alert" className="mt-1.5 block text-[10px] text-[#FCA5A5]">
                Amount exceeds your available balance.
              </span>
            )}
          </label>

          {error && (
            <div role="alert" className="border border-[#FCA5A5]/25 bg-[#261719] px-3 py-2 text-[11px] text-[#FCA5A5]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex h-11 w-full items-center justify-center gap-2 bg-emerald-500 text-[12px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-[#047857] disabled:text-[#A7B9B0]"
          >
            Confirm transfer
          </button>
        </form>
      </section>
    </div>
  );
}
