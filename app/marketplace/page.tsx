"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QueryVault, { VAULT_TABS, type VaultTab } from "@/components/QueryVault";
import { useWallet } from "@/components/WalletProvider";
import { fetchNearBalance, isValidNearAccountId, type NearAccountBalance } from "@/lib/nearAccount";
import { extractTransactionHash, transferNear } from "@/lib/near-transfers";
import { getTransactionExplorerUrl, getTreasuryAccount, yoctoToNearAmount } from "@/lib/paymentConfig";
import { getWalletActivity, recordWalletActivity, type WalletActivity, type WalletActivityDraft } from "@/lib/walletActivity";

const ACTIVITY_LABELS: Record<WalletActivity["kind"], string> = {
  query: "Asked",
  send: "Sent",
  deposit: "Received",
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatAccountLabel(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 7)}…${address.slice(-4)}`;
}

function toSendErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/reject|cancel|denied|closed|declin/.test(message)) return "Send cancelled.";
  if (/insufficient|not enough|balance/.test(message)) return "Not enough NEAR for this send.";
  return "The send didn't go through. Please try again.";
}

type SendStage = "edit" | "review" | "sending";

export default function MarketplacePage() {
  const router = useRouter();
  const { accountId, wallet, isReady, error: walletContextError, signOut } = useWallet();
  const [providerAddress, setProviderAddress] = useState("");
  const [balance, setBalance] = useState<NearAccountBalance | null>(null);
  const [balanceFailed, setBalanceFailed] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<VaultTab>("gateway");
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [walletPanel, setWalletPanel] = useState<"receive" | "send" | null>(null);
  const [walletActivity, setWalletActivity] = useState<{ accountId: string; entries: WalletActivity[] } | null>(null);
  const [sendRecipient, setSendRecipient] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendStage, setSendStage] = useState<SendStage>("edit");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const previousBalanceRef = useRef<{ accountId: string; yocto: bigint } | null>(null);
  const treasuryAccount = getTreasuryAccount();

  // Wallet gate: the marketplace is only reachable with a connected NEAR
  // wallet. Once the selector has restored its session, send visitors without
  // an account (or anyone who disconnects) back to the landing page.
  const isGateOpen = isReady && Boolean(accountId);
  useEffect(() => {
    if (isReady && !accountId) router.replace("/");
  }, [isReady, accountId, router]);

  useEffect(() => {
    if (!isWalletOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !walletMenuRef.current?.contains(event.target)) {
        setIsWalletOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsWalletOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isWalletOpen]);

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
        const previousBalance = previousBalanceRef.current;
        if (previousBalance?.accountId === accountId && next.yocto > previousBalance.yocto) {
          const activity = recordWalletActivity(accountId, {
            kind: "deposit",
            amountNear: yoctoToNearAmount(next.yocto - previousBalance.yocto),
            title: "Deposit",
          });
          setWalletActivity({ accountId, entries: activity });
        }
        previousBalanceRef.current = { accountId, yocto: next.yocto };
        setBalance(next);
        setBalanceFailed(null);
      } catch {
        if (cancelled) return;
        setBalance(null);
        setBalanceFailed(accountId);
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
  // switching wallets can never display another account's balance.
  const activeBalance = accountId && balance?.accountId === accountId ? balance : null;
  const balanceUnavailable = Boolean(accountId) && balanceFailed === accountId;
  const balanceLabel = activeBalance
    ? `${activeBalance.near} NEAR`
    : balanceUnavailable ? "Unavailable" : "Loading…";
  const activeWalletActivity = !accountId
    ? []
    : walletActivity?.accountId === accountId
      ? walletActivity.entries
      : getWalletActivity(accountId);

  function addWalletActivity(activity: WalletActivityDraft) {
    if (!accountId) return;
    setWalletActivity({
      accountId,
      entries: recordWalletActivity(accountId, activity),
    });
  }

  function toggleWalletPanel(panel: "receive" | "send") {
    setWalletPanel((current) => current === panel ? null : panel);
    setSendError(null);
    setSendSuccess(null);
  }

  async function handleWalletDisconnect() {
    setIsSigningOut(true);
    setWalletError(null);
    try {
      await signOut();
      setIsWalletOpen(false);
    } catch {
      setWalletError("Couldn't disconnect your wallet. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleCopyAddress() {
    if (!accountId) return;
    try {
      await navigator.clipboard.writeText(accountId);
      setCopiedAddress(true);
    } catch {
      setWalletError("Couldn't copy automatically. Select the address to copy it.");
    }
  }

  function handleReviewSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendError(null);
    setSendSuccess(null);

    const recipient = sendRecipient.trim();
    const amount = Number(sendAmount);
    if (!isValidNearAccountId(recipient)) {
      setSendError("Enter a valid NEAR account.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setSendError("Enter an amount greater than zero.");
      return;
    }
    if (activeBalance && Number(activeBalance.near) < amount) {
      setSendError("Not enough NEAR for this send.");
      return;
    }

    setSendRecipient(recipient);
    setSendAmount(String(Number(amount.toFixed(8))));
    setSendStage("review");
  }

  async function handleConfirmSend() {
    if (!accountId || !wallet) return;
    setSendError(null);
    setSendStage("sending");

    try {
      const result = await transferNear({ accountId, wallet }, sendRecipient, sendAmount);
      const txHash = extractTransactionHash(result) ?? undefined;
      addWalletActivity({ kind: "send", amountNear: sendAmount, title: sendRecipient, txHash });
      setSendSuccess(`Sent ${sendAmount} NEAR to ${sendRecipient}.`);
      setSendRecipient("");
      setSendAmount("");
      setSendStage("edit");
    } catch (error) {
      setSendStage("review");
      setSendError(toSendErrorMessage(error));
    }
  }

  if (!isGateOpen) {
    return (
      <div className="grid min-h-screen place-items-center px-4 text-slate-100">
        <div role="status" className="flex items-center gap-3 text-sm text-slate-400">
          <span className="size-1.5 animate-pulse rounded-full bg-cyan-400" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="BlindSight home">
            <span className="grid size-9 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/10">
              <Image src="/logo.png" alt="" width={26} height={26} className="h-6 w-6 object-contain" priority />
            </span>
            <span className="text-sm font-semibold text-white">BlindSight</span>
          </Link>

          <nav aria-label="Marketplace" className="order-3 w-full sm:order-2 sm:ml-6 sm:w-auto">
            <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-slate-900/70 p-1 sm:flex">
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
                    className={`min-h-9 rounded-lg px-4 text-sm font-medium transition ${
                      isActive ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div ref={walletMenuRef} className="relative order-2 ml-auto sm:order-3">
            <button
              type="button"
              onClick={() => setIsWalletOpen((open) => !open)}
              aria-expanded={isWalletOpen}
              aria-controls="wallet-panel"
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-slate-900/80 px-3.5 text-sm text-slate-100 transition hover:border-white/20"
            >
              <span className="font-medium">Wallet</span>
              <svg aria-hidden="true" viewBox="0 0 12 12" className={`size-3 text-slate-400 transition ${isWalletOpen ? "rotate-180" : ""}`}>
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>

            {isWalletOpen && accountId && (
              <div
                id="wallet-panel"
                role="dialog"
                aria-label="Wallet"
                className="absolute right-0 top-full z-50 mt-2 max-h-[min(80vh,640px)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/95 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl"
              >
                <div className="p-4">
                  <p className="text-xs text-slate-400">Balance</p>
                  <p className="text-2xl font-semibold text-white">{balanceLabel}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-slate-400" title={accountId}>
                      {formatAccountLabel(accountId)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyAddress()}
                      className="shrink-0 text-xs text-slate-400 transition hover:text-white"
                    >
                      {copiedAddress ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {(["send", "receive"] as const).map((panel) => (
                      <button
                        key={panel}
                        type="button"
                        aria-expanded={walletPanel === panel}
                        aria-controls={`wallet-${panel}-panel`}
                        onClick={() => toggleWalletPanel(panel)}
                        className={`min-h-10 rounded-xl border text-sm font-medium transition ${
                          walletPanel === panel
                            ? "border-cyan-400/40 bg-cyan-500/10 text-white"
                            : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                        }`}
                      >
                        {panel === "send" ? "Send" : "Receive"}
                      </button>
                    ))}
                  </div>

                  {walletPanel === "receive" && (
                    <div id="wallet-receive-panel" className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-xs text-slate-400">Your address</p>
                      <p className="mt-1 select-all break-all font-mono text-sm text-white">{accountId}</p>
                      <button
                        type="button"
                        onClick={() => void handleCopyAddress()}
                        className="mt-3 min-h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] text-sm font-medium text-slate-100 transition hover:bg-white/[0.08]"
                      >
                        {copiedAddress ? "Copied" : "Copy address"}
                      </button>
                    </div>
                  )}

                  {walletPanel === "send" && (
                    <div id="wallet-send-panel" className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      {sendStage === "edit" ? (
                        <form onSubmit={handleReviewSend} className="grid gap-3">
                          <label className="block">
                            <span className="mb-1 block text-xs text-slate-400">To</span>
                            <input
                              value={sendRecipient}
                              onChange={(event) => setSendRecipient(event.target.value)}
                              autoComplete="off"
                              spellCheck={false}
                              className="min-h-10 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 text-base text-slate-100 outline-none focus:border-cyan-400/60 sm:text-sm"
                              placeholder="Recipient NEAR account"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-slate-400">Amount (NEAR)</span>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              value={sendAmount}
                              onChange={(event) => setSendAmount(event.target.value)}
                              className="min-h-10 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 text-base text-slate-100 outline-none focus:border-cyan-400/60 sm:text-sm"
                              placeholder="0.1"
                            />
                          </label>
                          <button
                            type="submit"
                            className="min-h-10 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 text-sm font-semibold text-slate-950 transition hover:brightness-110"
                          >
                            Review send
                          </button>
                        </form>
                      ) : (
                        <div className="grid gap-3">
                          <dl className="grid gap-1.5 text-sm">
                            <div className="flex justify-between gap-3">
                              <dt className="text-slate-400">To</dt>
                              <dd className="truncate text-white">{sendRecipient}</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt className="text-slate-400">Amount</dt>
                              <dd className="text-white">{sendAmount} NEAR</dd>
                            </div>
                          </dl>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setSendStage("edit")}
                              disabled={sendStage === "sending"}
                              className="min-h-10 rounded-xl border border-white/10 bg-white/[0.04] text-sm font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:opacity-50"
                            >
                              Back
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleConfirmSend()}
                              disabled={sendStage === "sending"}
                              className="min-h-10 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:opacity-60"
                            >
                              {sendStage === "sending" ? "Sending…" : "Send"}
                            </button>
                          </div>
                        </div>
                      )}
                      {sendError && <p role="alert" className="mt-2 text-xs leading-5 text-rose-300">{sendError}</p>}
                      {sendSuccess && <p role="status" className="mt-2 text-xs leading-5 text-emerald-300">{sendSuccess}</p>}
                    </div>
                  )}
                </div>

                <section className="border-t border-white/10 px-4 py-3">
                  <h3 className="text-xs font-medium text-slate-400">History</h3>
                  {activeWalletActivity.length > 0 ? (
                    <ul className="mt-1 divide-y divide-white/[0.06]">
                      {activeWalletActivity.slice(0, 10).map((activity) => {
                        const isIncoming = activity.kind === "deposit";
                        const row = (
                          <>
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-slate-100">
                                {ACTIVITY_LABELS[activity.kind]}
                                {activity.kind !== "deposit" && <span className="text-slate-400"> · {activity.title}</span>}
                              </span>
                              <span className="block text-xs text-slate-500">{dateFormatter.format(activity.timestamp)}</span>
                            </span>
                            <span className={`shrink-0 text-sm ${isIncoming ? "text-emerald-300" : "text-slate-200"}`}>
                              {isIncoming ? "+" : "−"}{activity.amountNear} NEAR
                            </span>
                          </>
                        );
                        return (
                          <li key={activity.id}>
                            {activity.txHash ? (
                              <a
                                href={getTransactionExplorerUrl(activity.txHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View details"
                                className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition hover:bg-white/[0.04]"
                              >
                                {row}
                              </a>
                            ) : (
                              <div className="flex items-center justify-between gap-3 py-2.5">{row}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="py-2 text-sm text-slate-500">No transactions yet.</p>
                  )}
                </section>

                <div className="border-t border-white/10 p-3">
                  <button
                    type="button"
                    onClick={() => void handleWalletDisconnect()}
                    disabled={isSigningOut}
                    className="min-h-10 w-full rounded-xl text-sm font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-rose-300 disabled:opacity-60"
                  >
                    {isSigningOut ? "Disconnecting…" : "Disconnect"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <QueryVault
          providerAddress={providerAddress || accountId || ""}
          onProviderAddressChange={setProviderAddress}
          treasuryAccount={treasuryAccount}
          onQueryPayment={addWalletActivity}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </main>

      {activeWalletError && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-start justify-between gap-4 rounded-xl border border-rose-400/30 bg-slate-950/95 px-4 py-3 text-sm text-rose-200 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:left-5 sm:bottom-5"
        >
          <span>{activeWalletError}</span>
          {walletError && (
            <button
              type="button"
              onClick={() => setWalletError(null)}
              aria-label="Dismiss"
              className="text-rose-300/70 hover:text-rose-100"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
