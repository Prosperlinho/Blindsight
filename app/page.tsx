"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import ConnectModal from "@/components/ConnectModal";
import ExportKeyModal from "@/components/ExportKeyModal";
import QueryVault from "@/components/QueryVault";
import WalletDepositModal from "@/components/WalletDepositModal";
import WalletSummary from "@/components/WalletSummary";
import WalletWithdrawModal from "@/components/WalletWithdrawModal";
import {
  createDeposit,
  createInstantWallet as generateEmbeddedWallet,
  disconnectEmbeddedWallet,
  ensureWalletLedger,
  exportPrivateKey as getEmbeddedPrivateKey,
  formatNearAmount,
  getStoredEmbeddedWallet,
  importPrivateKey as importEmbeddedPrivateKey,
  ACCOUNTS_LEDGER_EVENT,
  WALLET_SYNC_EVENT,
  WALLETS_DB_STORAGE_KEY,
  roundNear,
  saveWalletLedger,
  sendNear,
  settleQueryPayment,
  type QuerySettlementResult,
  type WalletLedger,
} from "@/lib/embeddedWallet";
import { disconnectWallet, getWalletConnectionState, initializeWalletSelector, openWalletModal } from "@/lib/nearWallet";

export default function Home() {
  const [providerAddress, setProviderAddress] = useState("provider.near");
  const [walletAccountId, setWalletAccountId] = useState<string | null>(null);
  const [walletSource, setWalletSource] = useState<"embedded" | "selector" | null>(null);
  const [walletLedger, setWalletLedger] = useState<WalletLedger | null>(null);
  const [isWalletLoading, setIsWalletLoading] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSuccessMessage, setWalletSuccessMessage] = useState("");
  const [walletModal, setWalletModal] = useState<"deposit" | "withdraw" | null>(null);
  const [isExportKeyOpen, setIsExportKeyOpen] = useState(false);

  useEffect(() => {
    if (!walletSuccessMessage) return;
    const timer = window.setTimeout(() => setWalletSuccessMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [walletSuccessMessage]);

  useEffect(() => {
    if (!walletAccountId) return;

    const refreshCurrentWallet = () => setWalletLedger(ensureWalletLedger(walletAccountId));
    const handleStorage = (event: StorageEvent) => {
      if (event.key === WALLETS_DB_STORAGE_KEY || event.key === null) refreshCurrentWallet();
    };

    window.addEventListener(WALLET_SYNC_EVENT, refreshCurrentWallet);
    window.addEventListener(ACCOUNTS_LEDGER_EVENT, refreshCurrentWallet);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(WALLET_SYNC_EVENT, refreshCurrentWallet);
      window.removeEventListener(ACCOUNTS_LEDGER_EVENT, refreshCurrentWallet);
      window.removeEventListener("storage", handleStorage);
    };
  }, [walletAccountId]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    async function syncWalletState() {
      try {
        const embeddedWallet = getStoredEmbeddedWallet();
        if (embeddedWallet) {
          setWalletAccountId(embeddedWallet.accountId);
          setWalletSource("embedded");
          setWalletLedger(ensureWalletLedger(embeddedWallet.accountId));
        }
      } catch (error) {
        setWalletError(error instanceof Error ? error.message : "Could not restore the embedded wallet.");
      }

      const selector = await initializeWalletSelector();
      if (!selector || cancelled) return;

      const update = () => {
        const selectorState = getWalletConnectionState(selector);
        let embeddedWallet: ReturnType<typeof getStoredEmbeddedWallet> = null;
        try {
          embeddedWallet = getStoredEmbeddedWallet();
        } catch (error) {
          setWalletError(error instanceof Error ? error.message : "Could not restore the embedded wallet.");
        }
        const accountId = selectorState.connected
          ? selectorState.accountId
          : embeddedWallet?.accountId ?? null;
        const source = selectorState.connected ? "selector" : embeddedWallet ? "embedded" : null;

        setWalletAccountId(accountId);
        setWalletSource(source);
        setWalletLedger((current) => {
          if (!accountId) return null;
          if (current?.accountId === accountId) return current;
          return ensureWalletLedger(accountId);
        });
        if (accountId) {
          setIsConnectModalOpen(false);
          setWalletError(null);
        }
      };

      update();

      const signedInSubscription = selector.on("signedIn", update);
      const signedOutSubscription = selector.on("signedOut", update);
      const accountsChangedSubscription = selector.on("accountsChanged", update);

      cleanup = () => {
        signedInSubscription.remove();
        signedOutSubscription.remove();
        accountsChangedSubscription.remove();
      };
    }

    void syncWalletState().catch((error: unknown) => {
      if (!cancelled) {
        setWalletError(error instanceof Error ? error.message : "Wallet selector could not be initialized.");
      }
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  function handleSettleQuery(priceNear: number, vaultTitle: string, publisherAddress: string): QuerySettlementResult {
    if (!walletAccountId) {
      return { success: false, message: "Connect a wallet to settle this query." };
    }

    const baseLedger = ensureWalletLedger(walletAccountId);
    const settlement = settleQueryPayment(baseLedger, priceNear, vaultTitle, publisherAddress);
    if (!settlement) {
      return {
        success: false,
        message: `Insufficient balance. This query costs ${priceNear.toFixed(2)} NEAR and your wallet holds ${formatNearAmount(baseLedger.balanceNear)}.`,
      };
    }

    setWalletLedger(settlement.senderLedger);
    return { success: true, transactionId: settlement.senderTransaction.id };
  }

  function handleOpenWalletAction(action: "deposit" | "withdraw") {
    setWalletModal(action);
  }

  function handleDeposit(amountNear: number): QuerySettlementResult {
    if (!walletAccountId) {
      return { success: false, message: "Connect a wallet before depositing." };
    }

    const baseLedger = ensureWalletLedger(walletAccountId);
    const deposit = createDeposit(baseLedger, amountNear);
    if (!deposit) {
      return { success: false, message: "Enter a valid deposit amount." };
    }

    saveWalletLedger(deposit.ledger);
    setWalletLedger(deposit.ledger);
    setWalletSuccessMessage(`Deposited ${formatNearAmount(amountNear)}. New balance: ${formatNearAmount(deposit.ledger.balanceNear)}.`);
    return { success: true, transactionId: deposit.transaction.id };
  }

  function handleWithdraw(recipient: string, amountNear: number): QuerySettlementResult {
    if (!walletAccountId) {
      return { success: false, message: "Connect a wallet before sending funds." };
    }

    const baseLedger = ensureWalletLedger(walletAccountId);
    const amount = roundNear(amountNear);
    const destination = recipient.trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, message: "Enter an amount greater than 0." };
    }
    if (!destination) {
      return { success: false, message: "Enter a recipient NEAR address." };
    }
    if (destination.toLowerCase() === walletAccountId.trim().toLowerCase()) {
      return { success: false, message: "Choose a recipient address different from your own wallet." };
    }
    if (amount > baseLedger.balanceNear + 1e-9) {
      return {
        success: false,
        message: `Amount exceeds your available balance of ${formatNearAmount(baseLedger.balanceNear)}.`,
      };
    }

    const transfer = sendNear(baseLedger, destination, amount);
    if (!transfer) {
      return { success: false, message: "Enter a valid recipient address and amount." };
    }

    setWalletLedger(transfer.senderLedger);
    setWalletSuccessMessage(`Sent ${formatNearAmount(amount)} to ${destination}. Recipient credited: ${formatNearAmount(transfer.recipientLedger.balanceNear)} balance. Your new balance: ${formatNearAmount(transfer.senderLedger.balanceNear)}.`);
    return { success: true, transactionId: transfer.senderTransaction.id };
  }

  function handleWalletConnect() {
    setWalletError(null);
    setIsConnectModalOpen(true);
  }

  async function handleCreateInstantWallet() {
    setIsWalletLoading(true);
    setWalletError(null);
    try {
      const wallet = generateEmbeddedWallet();
      setWalletAccountId(wallet.accountId);
      setWalletSource("embedded");
      setWalletLedger(ensureWalletLedger(wallet.accountId));
      setWalletSuccessMessage(`Instant Wallet Created! Address: ${wallet.accountId}`);
      setIsConnectModalOpen(false);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not create an embedded wallet.");
    } finally {
      setIsWalletLoading(false);
    }
  }

  function handleImportEmbeddedWallet(secretKey: string) {
    setIsWalletLoading(true);
    setWalletError(null);
    try {
      const accountId = importEmbeddedPrivateKey(secretKey);
      setWalletAccountId(accountId);
      setWalletSource("embedded");
      setWalletLedger(ensureWalletLedger(accountId));
      setWalletSuccessMessage(`Embedded wallet imported! Address: ${accountId}`);
      setIsConnectModalOpen(false);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not import the embedded wallet key.");
    } finally {
      setIsWalletLoading(false);
    }
  }

  function handleOpenExportKey() {
    setWalletError(null);
    setIsExportKeyOpen(true);
  }

  async function handleExistingWalletConnect() {
    setIsConnectModalOpen(false);
    setIsWalletLoading(true);
    setWalletError(null);
    try {
      await openWalletModal();
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not open the wallet selector.");
      setIsConnectModalOpen(true);
    } finally {
      setIsWalletLoading(false);
    }
  }

  async function handleWalletDisconnect() {
    setIsWalletLoading(true);
    try {
      if (walletSource === "embedded") {
        disconnectEmbeddedWallet();
      } else {
        await disconnectWallet();
      }
      const selector = await initializeWalletSelector();
      const selectorState = getWalletConnectionState(selector);
      const embeddedWallet = getStoredEmbeddedWallet();
      const connectedAccountId = selectorState.connected
        ? selectorState.accountId
        : embeddedWallet?.accountId ?? null;
      setWalletAccountId(connectedAccountId);
      setWalletSource(selectorState.connected ? "selector" : embeddedWallet ? "embedded" : null);
      setWalletLedger(connectedAccountId ? ensureWalletLedger(connectedAccountId) : null);
      setWalletSuccessMessage("");
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not disconnect the wallet.");
    } finally {
      setIsWalletLoading(false);
    }
  }

  return (
    <div className="min-h-screen text-[#F0FDF4]">
      <header className="relative border-b border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1500px] items-center justify-between px-5 sm:px-8">
          <a href="#home" className="flex items-center gap-3" aria-label="BlindSight home">
            <Image
              src="/logo.png"
              alt="Blindsight Logo"
              width={36}
              height={36}
              className="h-9 w-9 object-contain drop-shadow-[0_0_10px_rgba(16,185,129,0.4)]"
              priority
            />
            <span className="text-[13px] font-semibold tracking-[0.1em]">BlindSight</span>
            <span className="hidden border-l border-emerald-500/20 pl-3 text-[11px] text-[#A7B9B0] sm:block">
              Private data, useful answers
            </span>
          </a>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden items-center gap-2 text-[11px] text-[#A7B9B0] xl:flex">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Query gateway preview
            </div>
            <div className="hidden h-5 w-px bg-[#047857] sm:block" />
            <div
              className="hidden items-center gap-2 border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1.5 text-[10px] text-emerald-400 lg:flex"
              title="NEAR settlement is simulated in this prototype."
            >
              <span className="size-1.5 rounded-full bg-[#34D399]" />
              <span>NEAR testnet · preview</span>
            </div>
            {walletAccountId ? (
              <WalletSummary
                ledger={walletLedger}
                variant="header"
                onBalanceClick={() => handleOpenWalletAction("withdraw")}
                onFaucetClick={() => { handleDeposit(1); }}
                onDepositClick={() => handleOpenWalletAction("deposit")}
                onWithdrawClick={() => handleOpenWalletAction("withdraw")}
                onExportKeyClick={walletSource === "embedded" ? handleOpenExportKey : undefined}
                onDisconnectClick={() => void handleWalletDisconnect()}
              />
            ) : (
              <button
                type="button"
                onClick={() => void handleWalletConnect()}
                disabled={isWalletLoading}
                className="flex items-center gap-2 border border-emerald-500/40 bg-emerald-500 px-3 py-2 text-[11px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
              >
                <span>{isWalletLoading ? "Connecting..." : "Connect Wallet"}</span>
              </button>
            )}
          </div>
        </div>

      </header>

      <main id="home" className="mx-auto max-w-[1420px] px-5 pb-12 pt-9 sm:px-8 sm:pt-12">
        <section className="mb-9 grid gap-8 border-b border-emerald-500/20 pb-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:items-end">
          <div>
            <p className="mb-4 text-[12px] text-[#A7B9B0]">A private data workspace</p>
            <h1 className="max-w-[780px] font-serif text-[clamp(42px,7vw,82px)] leading-[0.98] tracking-[-0.045em] text-[#F0FDF4]">
              Questions out.
              <br />
              Files stay in<span className="text-[#10B981]">.</span>
            </h1>
            <p className="mt-5 max-w-[540px] text-[14px] leading-6 text-[#A7B9B0]">
              Ask for the insight you need. Keep the source on your side.
            </p>
          </div>
          <div aria-hidden="true" className="hidden min-h-[150px] items-end justify-end lg:flex">
            <svg viewBox="0 0 360 150" fill="none" className="w-full max-w-[370px] text-[#34D399]">
              <path d="M56 78h110m28 0h110" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" />
              <path d="m157 73 9 5-9 5m46-10-9 5 9 5" stroke="#10B981" strokeWidth="1.5" />
              <rect x="14" y="34" width="70" height="88" rx="1" stroke="currentColor" strokeOpacity=".65" />
              <path d="M29 56h39M29 68h31M29 80h34M29 92h23" stroke="currentColor" strokeOpacity=".65" />
              <circle cx="180" cy="78" r="31" stroke="currentColor" strokeOpacity=".7" />
              <circle cx="180" cy="78" r="20" stroke="#10B981" strokeOpacity=".75" />
              <path d="M174 78h12m-6-6v12" stroke="#10B981" strokeWidth="1.4" />
              <rect x="276" y="45" width="70" height="66" rx="1" stroke="currentColor" strokeOpacity=".65" />
              <path d="M291 64h39m-39 12h32m-32 12h24" stroke="currentColor" strokeOpacity=".65" />
              <text x="14" y="139" fill="currentColor" fontSize="9">SOURCE</text>
              <text x="151" y="128" fill="currentColor" fontSize="9">PRIVATE QUERY</text>
              <text x="276" y="128" fill="currentColor" fontSize="9">ANSWER</text>
            </svg>
          </div>
        </section>

        <QueryVault
          providerAddress={providerAddress}
          onProviderAddressChange={setProviderAddress}
          walletLedger={walletLedger}
          onSettleQuery={handleSettleQuery}
        />

        <footer className="mt-7 flex flex-col gap-3 border-t border-emerald-500/20 pt-4 text-[10px] text-[#7D9187] sm:flex-row sm:items-center sm:justify-between">
          <span>BlindSight · Confidential data marketplace</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>NEAR settlement · simulated</span>
            <span>TEE verification · simulated</span>
            <span>Prototype build</span>
          </div>
        </footer>
      </main>
      {walletError && !isConnectModalOpen && (
        <div
          role="alert"
          className="fixed bottom-5 left-5 z-20 flex max-w-[min(420px,calc(100vw-40px))] items-start gap-4 border border-[#7F1D1D]/50 bg-[#261719] px-4 py-3 text-xs leading-5 text-[#FCA5A5] shadow-2xl shadow-black/40"
        >
          <span>{walletError}</span>
          <button
            type="button"
            onClick={() => setWalletError(null)}
            aria-label="Dismiss wallet error"
            className="text-sm text-[#FCA5A5]/70 hover:text-[#FCA5A5]"
          >
            ×
          </button>
        </div>
      )}
      {walletSuccessMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-20 w-[min(460px,calc(100vw-40px))] border border-emerald-500/20 bg-emerald-950/40 p-4 text-xs leading-5 text-[#E2F8EC] shadow-2xl shadow-black/40"
        >
          <div className="flex items-start justify-between gap-4">
            <span className="break-all">{walletSuccessMessage}</span>
            <button
              type="button"
              onClick={() => setWalletSuccessMessage("")}
              aria-label="Dismiss wallet created message"
              className="shrink-0 text-sm text-[#A7B9B0] hover:text-[#F0FDF4]"
            >
              ×
            </button>
          </div>
        </div>
      )}
      {isExportKeyOpen && (
        <ExportKeyModal
          open
          accountId={walletAccountId ?? ""}
          onClose={() => setIsExportKeyOpen(false)}
          getPrivateKey={getEmbeddedPrivateKey}
          onError={setWalletError}
        />
      )}
      {walletModal === "deposit" && walletLedger && (
        <WalletDepositModal
          ledger={walletLedger}
          onClose={() => setWalletModal(null)}
          onDeposit={handleDeposit}
        />
      )}
      {walletModal === "withdraw" && walletLedger && (
        <WalletWithdrawModal
          ledger={walletLedger}
          onClose={() => setWalletModal(null)}
          onWithdraw={handleWithdraw}
        />
      )}
      <ConnectModal
        open={isConnectModalOpen}
        isLoading={isWalletLoading}
        error={walletError}
        onClose={() => setIsConnectModalOpen(false)}
        onCreateInstantWallet={() => void handleCreateInstantWallet()}
        onImportPrivateKey={handleImportEmbeddedWallet}
        onConnectExistingWallet={() => void handleExistingWalletConnect()}
      />
    </div>
  );
}
