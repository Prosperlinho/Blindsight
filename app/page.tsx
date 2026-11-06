"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import ConnectModal from "@/components/ConnectModal";
import QueryVault, { VAULT_TABS, type VaultTab } from "@/components/QueryVault";
import { useWallet } from "@/components/WalletProvider";
import { createAuditLogEntry, type AuditLogEntry } from "@/lib/auditLog";
import { fetchNearBalance, type NearAccountBalance } from "@/lib/nearAccount";
import { getTreasuryAccount, getTreasuryExplorerUrl } from "@/lib/paymentConfig";

function formatAccountLabel(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 7)}…${address.slice(-4)}`;
}

export default function Home() {
  const { accountId, isReady, error: walletContextError, signIn, signOut } = useWallet();
  const [providerAddress, setProviderAddress] = useState("");
  const [balance, setBalance] = useState<NearAccountBalance | null>(null);
  const [balanceError, setBalanceError] = useState<{ accountId: string; message: string } | null>(null);
  const [isWalletLoading, setIsWalletLoading] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<VaultTab>("gateway");
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const treasuryAccount = getTreasuryAccount();

  useEffect(() => {
    if (!isWalletMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !walletMenuRef.current?.contains(event.target)) {
        setIsWalletMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsWalletMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isWalletMenuOpen]);

  useEffect(() => {
    if (!accountId) return;

    let cancelled = false;
    let inFlight = false;

    const loadBalance = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await fetchNearBalance(accountId);
        if (cancelled) return;
        setBalance(next);
        setBalanceError(null);
      } catch (error) {
        if (cancelled) return;
        setBalance(null);
        setBalanceError({
          accountId,
          message: error instanceof Error
            ? error.message
            : "The NEAR testnet balance could not be read.",
        });
      } finally {
        inFlight = false;
      }
    };

    void loadBalance();
    const intervalId = window.setInterval(() => void loadBalance(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [accountId]);

  useEffect(() => {
    if (!copiedAddress) return;
    const timer = window.setTimeout(() => setCopiedAddress(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [copiedAddress]);

  const activeWalletError = walletError ?? walletContextError;
  // Only show balance data that belongs to the currently connected account, so
  // switching wallets can never display another account's on-chain balance.
  const activeBalance = accountId && balance?.accountId === accountId ? balance : null;
  const activeBalanceError = accountId && balanceError?.accountId === accountId
    ? balanceError.message
    : null;

  function handleWalletConnect() {
    setWalletError(null);
    setIsConnectModalOpen(true);
  }

  async function handleConnectExistingWallet() {
    setIsConnectModalOpen(false);
    setIsWalletLoading(true);
    setWalletError(null);
    try {
      await signIn();
    } catch (error) {
      setWalletError(
        error instanceof Error ? error.message : "Could not open the NEAR wallet selector.",
      );
      setIsConnectModalOpen(true);
    } finally {
      setIsWalletLoading(false);
    }
  }

  async function handleWalletDisconnect() {
    setIsWalletLoading(true);
    setWalletError(null);
    try {
      await signOut();
      setBalance(null);
      setBalanceError(null);
      setIsWalletMenuOpen(false);
    } catch (error) {
      setWalletError(
        error instanceof Error ? error.message : "The NEAR wallet could not be disconnected.",
      );
    } finally {
      setIsWalletLoading(false);
    }
  }

  async function handleCopyAddress() {
    if (!accountId) return;
    try {
      await navigator.clipboard.writeText(accountId);
      setCopiedAddress(true);
    } catch {
      setWalletError("The browser blocked clipboard access. Copy the address manually.");
    }
  }

  function handleAuditLog(message: string, txHash?: string) {
    setAuditLog((current) => [createAuditLogEntry(message, txHash), ...current]);
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden text-slate-100">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-24 top-0 size-[420px] rounded-full bg-cyan-500/10 blur-[140px]" />
        <div className="absolute -right-24 top-24 size-[460px] rounded-full bg-purple-500/10 blur-[160px]" />
        <div className="absolute bottom-0 left-1/3 size-[380px] rounded-full bg-blue-500/[0.07] blur-[150px]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#home" className="flex items-center gap-2.5" aria-label="BlindSight home">
            <span className="grid size-9 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_25px_rgba(56,189,248,0.15)]">
              <Image
                src="/logo.png"
                alt=""
                width={26}
                height={26}
                className="h-6 w-6 object-contain"
                priority
              />
            </span>
            <span className="text-sm font-semibold tracking-[0.08em] text-white">BlindSight</span>
          </a>

          <div className="order-3 w-full animate-float sm:order-2 sm:w-auto sm:flex-1 sm:px-6">
            <h1 className="animate-shimmer bg-gradient-to-r from-white via-cyan-100 to-purple-200 bg-clip-text text-center text-lg font-black leading-tight tracking-[-0.02em] text-transparent sm:text-xl lg:text-2xl">
              Ask for the insight you need. Keep the source on your side.
            </h1>
          </div>

          <div className="order-2 ml-auto flex items-center gap-2 sm:order-3 sm:ml-0">
            {accountId ? (
              <div ref={walletMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsWalletMenuOpen((open) => !open)}
                  aria-expanded={isWalletMenuOpen}
                  aria-haspopup="dialog"
                  aria-label="Open wallet details"
                  className="inline-flex animate-float items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-3 py-1.5 text-[11px] text-slate-100 shadow-[0_0_20px_rgba(34,211,238,0.12)] backdrop-blur-2xl transition hover:border-cyan-400/40"
                >
                  <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse-glow" />
                  <span className="hidden font-mono sm:inline">{formatAccountLabel(accountId)}</span>
                  <span className="sm:hidden">Wallet</span>
                  {activeBalance && (
                    <span className="hidden animate-shimmer bg-gradient-to-r from-cyan-200 via-white to-purple-200 bg-clip-text font-mono text-[10px] text-transparent md:inline">
                      {activeBalance.near} NEAR
                    </span>
                  )}
                  <span aria-hidden="true" className="text-[9px] text-slate-400">
                    {isWalletMenuOpen ? "▲" : "▼"}
                  </span>
                </button>

                {isWalletMenuOpen && (
                  <div
                    role="dialog"
                    aria-label="Wallet details"
                    className="absolute right-0 top-full z-50 mt-2 w-[min(340px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">
                          NEAR testnet · real wallet
                        </div>
                        <div
                          className="mt-0.5 truncate font-mono text-[11px] text-slate-100"
                          title={accountId}
                        >
                          {accountId}
                        </div>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-medium text-cyan-200">
                        <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse-glow" />
                        Testnet
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2 p-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                        <span className="block text-[9px] uppercase tracking-[0.14em] text-slate-500">
                          On-chain balance
                        </span>
                        <span className="mt-1 block animate-shimmer bg-gradient-to-r from-cyan-200 via-white to-purple-200 bg-clip-text font-mono text-[15px] text-transparent">
                          {activeBalance ? `${activeBalance.near} NEAR` : activeBalanceError ? "Unavailable" : "Reading RPC…"}
                        </span>
                        {activeBalanceError && (
                          <span className="mt-1 block text-[9px] leading-4 text-rose-300">
                            {activeBalanceError}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1 border-t border-white/10 p-2">
                      <button
                        type="button"
                        onClick={() => void handleCopyAddress()}
                        className="rounded-lg px-2 py-2 text-[10px] text-slate-300 transition hover:bg-white/5 hover:text-cyan-200"
                      >
                        {copiedAddress ? "Copied ✓" : "Copy address"}
                      </button>
                      <a
                        href={getTreasuryExplorerUrl(accountId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg px-2 py-2 text-center text-[10px] text-slate-300 transition hover:bg-white/5 hover:text-cyan-200"
                      >
                        View on NearBlocks ↗
                      </a>
                    </div>

                    <div className="border-t border-white/10 p-2">
                      <button
                        type="button"
                        onClick={() => void handleWalletDisconnect()}
                        disabled={isWalletLoading}
                        className="w-full rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold text-rose-200 transition hover:border-rose-300/60 hover:bg-rose-500/20 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isWalletLoading ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleWalletConnect}
                disabled={isWalletLoading || !isReady}
                className="rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 px-4 py-2 text-[11px] font-semibold text-slate-950 shadow-[0_0_25px_rgba(34,211,238,0.25)] transition-all duration-300 hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              >
                {isWalletLoading ? "Opening…" : isReady ? "Connect Wallet" : "Initializing…"}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="relative z-30 px-4 pt-5 sm:px-6">
        <nav
          aria-label="Vault sections"
          className="mx-auto max-w-xl animate-fade-up rounded-full border border-white/10 bg-slate-900/80 p-1.5 shadow-2xl shadow-cyan-500/10 backdrop-blur-2xl"
        >
          <div role="tablist" aria-label="Vault views" className="flex items-center gap-1">
            {VAULT_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`${tab.id}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`${tab.id}-panel`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 whitespace-nowrap rounded-full border px-2 py-2 text-[10px] font-medium transition-all duration-300 ease-in-out sm:px-3 sm:text-[11px] ${
                    isActive
                      ? "border-cyan-400/50 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white shadow-[0_0_15px_rgba(6,182,212,0.3)]"
                      : "border-transparent text-slate-400 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span className={isActive ? "inline-block animate-float" : "inline-block"}>
                    <span
                      className={
                        isActive
                          ? "animate-shimmer bg-gradient-to-r from-white via-cyan-100 to-purple-200 bg-clip-text text-transparent"
                          : undefined
                      }
                    >
                      {tab.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      <main id="home" className="mx-auto max-w-5xl px-4 pb-16 pt-5 sm:px-6">
        <QueryVault
          providerAddress={providerAddress || accountId || ""}
          onProviderAddressChange={setProviderAddress}
          nearAccountId={accountId}
          walletBalanceNear={activeBalance?.near ?? null}
          walletBalanceError={activeBalanceError}
          treasuryAccount={treasuryAccount}
          auditLog={auditLog}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onAuditLog={handleAuditLog}
        />

        <footer className="mx-auto mt-8 flex max-w-3xl flex-col gap-2 border-t border-white/10 pt-4 text-[10px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>BlindSight · Confidential data marketplace</span>
          <span className="inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse-glow" />
            Real NEAR testnet payment · real NEAR AI inference
          </span>
        </footer>
      </main>

      {activeWalletError && !isConnectModalOpen && (
        <div
          role="alert"
          className="fixed bottom-5 left-5 z-20 flex max-w-[min(420px,calc(100vw-40px))] items-start gap-4 rounded-xl border border-rose-400/30 bg-slate-950/95 px-4 py-3 text-xs leading-5 text-rose-200 shadow-2xl shadow-rose-950/40 backdrop-blur-xl"
        >
          <span>{activeWalletError}</span>
          <button
            type="button"
            onClick={() => setWalletError(null)}
            aria-label="Dismiss wallet error"
            className="text-sm text-rose-300/70 hover:text-rose-100"
          >
            ×
          </button>
        </div>
      )}

      <ConnectModal
        open={isConnectModalOpen}
        isLoading={isWalletLoading}
        error={activeWalletError}
        onClose={() => setIsConnectModalOpen(false)}
        onConnect={() => void handleConnectExistingWallet()}
      />
    </div>
  );
}
