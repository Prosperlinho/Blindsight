"use client";

import { useEffect, useRef, useState } from "react";
import { formatNearAmount, type WalletLedger, type WalletTransaction } from "@/lib/embeddedWallet";

type WalletSummaryProps = {
  ledger: WalletLedger | null;
  variant?: "header" | "panel";
};

function TransactionLedger({ transactions }: { transactions: WalletTransaction[] }) {
  if (!transactions.length) {
    return (
      <div className="border-t border-emerald-500/20 px-4 py-3 text-[10px] text-[#7D9187]">
        No transactions recorded yet.
      </div>
    );
  }

  return (
    <ul className="max-h-[260px] divide-y divide-white/[0.06] overflow-y-auto overflow-x-hidden border-t border-emerald-500/20">
      {transactions.map((transaction) => {
        const isCredit = transaction.type === "FAUCET_CREDIT";
        return (
          <li key={transaction.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-6 shrink-0 place-items-center border text-[10px] ${
                  isCredit
                    ? "border-emerald-500/25 bg-emerald-950/40 text-[#34D399]"
                    : "border-[#FCA5A5]/20 bg-[#261719] text-[#FCA5A5]"
                }`}
              >
                {isCredit ? "↓" : "↑"}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[11px] text-[#E2F8EC]">{transaction.description}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] text-[#7D9187]">
                  <span className="uppercase tracking-[0.12em]">{transaction.status}</span>
                  <span aria-hidden="true">·</span>
                  <span>{transaction.timestamp}</span>
                  {transaction.recipient && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{transaction.recipient}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <span className={`shrink-0 whitespace-nowrap font-mono text-[11px] ${isCredit ? "text-[#34D399]" : "text-[#FCA5A5]"}`}>
              {transaction.amount}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default function WalletSummary({ ledger, variant = "panel" }: WalletSummaryProps) {
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  async function handleCopyAddress() {
    if (!ledger) return;
    try {
      await navigator.clipboard.writeText(ledger.address);
      setCopied(true);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, 1800);
    } catch {
      setCopied(false);
    }
  }

  if (!ledger) {
    if (variant === "header") return null;
    return (
      <div className="border border-emerald-500/20 bg-[#0B0F17]/60 px-4 py-3 text-[11px] leading-5 text-[#7D9187]">
        Connect a wallet to unlock a test balance, query settlement, and transaction history.
      </div>
    );
  }

  if (variant === "header") {
    return (
      <div className="relative flex items-center gap-1.5">
        <div
          className="flex items-center gap-2 border border-[#34D399]/40 bg-[#0B0F17]/80 px-2.5 py-1.5 backdrop-blur-xl"
          title={ledger.address}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="shrink-0 font-mono text-[10px] font-medium text-[#34D399]">
            {formatNearAmount(ledger.balanceNear)}
          </span>
          <span className="hidden max-w-[150px] truncate font-mono text-[10px] text-[#A7B9B0] xl:inline">
            {ledger.address}
          </span>
          <button
            type="button"
            onClick={() => void handleCopyAddress()}
            aria-label={`Copy wallet address ${ledger.address}`}
            className="shrink-0 border-l border-emerald-500/20 pl-2 text-[10px] text-[#A7B9B0] transition hover:text-[#34D399]"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setHistoryOpen((current) => !current)}
          aria-expanded={historyOpen}
          aria-controls="header-transaction-history"
          className={`flex items-center gap-1.5 border px-2 py-1.5 text-[10px] transition ${
            historyOpen
              ? "border-emerald-500/40 bg-emerald-950/40 text-[#F0FDF4]"
              : "border-emerald-500/20 text-[#A7B9B0] hover:border-emerald-500/40 hover:text-[#F0FDF4]"
          }`}
        >
          History
          <span className="hidden border border-emerald-500/20 px-1 font-mono text-[9px] text-[#34D399] lg:inline">
            {ledger.transactions.length}
          </span>
        </button>
        {historyOpen && (
          <div
            id="header-transaction-history"
            role="region"
            aria-label="Transaction history"
            className="absolute right-0 top-full z-40 mt-2 w-[min(360px,calc(100vw-40px))] border border-emerald-500/20 bg-[#0B0F17]/95 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#7D9187]">Transaction history</span>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close transaction history"
                className="text-sm text-[#A7B9B0] transition hover:text-[#F0FDF4]"
              >
                ×
              </button>
            </div>
            <TransactionLedger transactions={ledger.transactions} />
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="min-w-0 overflow-hidden border border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.14em] text-[#7D9187]">Wallet balance</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[22px] font-medium text-[#F0FDF4]">
              {formatNearAmount(ledger.balanceNear)}
            </span>
            <span className="border border-emerald-500/20 bg-emerald-950/30 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.14em] text-[#34D399]">
              TESTNET FAUCET
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#A7B9B0]">
            <span className="break-all font-mono" title={ledger.address}>
              {ledger.address}
            </span>
            <button
              type="button"
              onClick={() => void handleCopyAddress()}
              aria-label={`Copy wallet address ${ledger.address}`}
              className="shrink-0 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] text-[#A7B9B0] transition hover:border-emerald-500/40 hover:text-[#34D399]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setHistoryOpen((current) => !current)}
          aria-expanded={historyOpen}
          aria-controls="panel-transaction-history"
          className={`flex w-full shrink-0 items-center justify-between gap-2 border px-2.5 py-2 text-[10px] transition sm:w-auto ${
            historyOpen
              ? "border-emerald-500/40 bg-emerald-950/40 text-[#F0FDF4]"
              : "border-emerald-500/20 text-[#A7B9B0] hover:border-emerald-500/40 hover:text-[#F0FDF4]"
          }`}
        >
          <span className="whitespace-nowrap">Transaction history</span>
          <span className="flex items-center gap-2">
            <span className="border border-emerald-500/20 px-1 font-mono text-[9px] text-[#34D399]">
              {ledger.transactions.length}
            </span>
            <span aria-hidden="true">{historyOpen ? "↑" : "↓"}</span>
          </span>
        </button>
      </div>
      {historyOpen && (
        <div id="panel-transaction-history" role="region" aria-label="Transaction history">
          <TransactionLedger transactions={ledger.transactions} />
        </div>
      )}
    </section>
  );
}
