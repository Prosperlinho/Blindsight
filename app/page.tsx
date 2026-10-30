"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import ConnectModal from "@/components/ConnectModal";
import QueryVault from "@/components/QueryVault";
import { executeDataPayout } from "@/lib/executeSettlement";
import {
  createInstantWallet as generateEmbeddedWallet,
  disconnectEmbeddedWallet,
  exportPrivateKey as getEmbeddedPrivateKey,
  getStoredEmbeddedWallet,
  importPrivateKey as importEmbeddedPrivateKey,
} from "@/lib/embeddedWallet";
import { disconnectWallet, getWalletConnectionState, initializeWalletSelector, openWalletModal } from "@/lib/nearWallet";

type VaultFile = {
  name: string;
  size: number;
  content: string;
};

type QueryResponse = {
  insight?: string;
  attestationToken?: string;
  error?: string;
  antiProbingCheck?: string;
  noiseAdded?: boolean;
  extractedText?: string;
};

type DatasetPreparationResponse = {
  datasetId?: string;
  error?: string;
};
type VaultParseResponse = {
  text?: string;
  error?: string;
};
type AgentBid = {
  bidAmountInUSDC: string;
  rowCount: number;
  ratePerRowUSDC: string;
  justification: string;
};

type AgentBidResponse = AgentBid & { error?: string };

const CIPHERTEXT_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomCiphertextChunk(length: number) {
  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (value) => CIPHERTEXT_ALPHABET[value % CIPHERTEXT_ALPHABET.length]).join("");
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [preparedDatasetId, setPreparedDatasetId] = useState("");
  const [isPreparingDataset, setIsPreparingDataset] = useState(false);
  const [vaultQueued, setVaultQueued] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [ciphertext, setCiphertext] = useState("");
  const [isValuing, setIsValuing] = useState(false);
  const [agentBid, setAgentBid] = useState<AgentBid | null>(null);
  const [acceptedBid, setAcceptedBid] = useState<AgentBid | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [insight, setInsight] = useState("");
  const [attestationToken, setAttestationToken] = useState("");
  const [settlementHash, setSettlementHash] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [providerAddress, setProviderAddress] = useState("provider.near");
  const [buyerBalance, setBuyerBalance] = useState(0);
  const [isDepositing, setIsDepositing] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const [walletAccountId, setWalletAccountId] = useState<string | null>(null);
  const [walletSource, setWalletSource] = useState<"embedded" | "selector" | null>(null);
  const [isWalletLoading, setIsWalletLoading] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSuccessMessage, setWalletSuccessMessage] = useState("");
  const [backupKey, setBackupKey] = useState<string | null>(null);
  const [backupKeyCopied, setBackupKeyCopied] = useState(false);
  const [antiProbingCheck, setAntiProbingCheck] = useState("PASSED");
  const [rateLimitAlert, setRateLimitAlert] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    async function syncWalletState() {
      try {
        const embeddedWallet = getStoredEmbeddedWallet();
        if (embeddedWallet) {
          setWalletAccountId(embeddedWallet.accountId);
          setWalletSource("embedded");
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
      setWalletSuccessMessage(`Embedded wallet imported! Address: ${accountId}`);
      setIsConnectModalOpen(false);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not import the embedded wallet key.");
    } finally {
      setIsWalletLoading(false);
    }
  }

  function handleExportEmbeddedWallet() {
    setWalletError(null);
    try {
      const privateKey = getEmbeddedPrivateKey();
      if (!privateKey) {
        throw new Error("No embedded wallet key was found in this browser.");
      }
      setBackupKey(privateKey);
      setBackupKeyCopied(false);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not export the embedded wallet key.");
    }
  }

  async function handleCopyBackupKey() {
    if (!backupKey) return;
    try {
      await navigator.clipboard.writeText(backupKey);
      setBackupKeyCopied(true);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not copy the backup key.");
    }
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
      setWalletSuccessMessage("");
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not disconnect the wallet.");
    } finally {
      setIsWalletLoading(false);
    }
  }

  async function handleDeposit() {
    if (isDepositing) return;
    setIsDepositing(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    setBuyerBalance(50);
    setIsDepositing(false);
  }

  async function extractVaultFileText(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/vault/parse", {
      method: "POST",
      body: formData,
    });

    const result = (await response.json()) as VaultParseResponse;
    if (!response.ok || typeof result.text !== "string") {
      throw new Error(result.error || `Unable to ingest ${file.name}.`);
    }

    return result.text;
  }

  async function prepareFilesForVault(datasetFiles: VaultFile[], judgeDemo = false) {
    setPreparedDatasetId("");
    setVaultQueued(false);
    setCiphertext("");
    setAgentBid(null);
    setAcceptedBid(null);
    setIsPreparingDataset(true);

    if (!datasetFiles.length) {
      setIsPreparingDataset(false);
      setErrorMessage("");
      return;
    }

    try {
      const dataset = datasetFiles.map((file) => `### ${file.name}\n${file.content}`).join("\n\n");
      const response = await fetch("/api/query-tee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", dataset }),
      });
      const result = (await response.json()) as DatasetPreparationResponse;
      if (!response.ok || !result.datasetId) {
        throw new Error(result.error || "Dataset preparation failed.");
      }
      setPreparedDatasetId(result.datasetId);
      if (judgeDemo) {
        const demoBid: AgentBid = {
          bidAmountInUSDC: "0.05",
          rowCount: 6,
          ratePerRowUSDC: "0.0083",
          justification: "Fixed sample bid for the hackathon judge demo.",
        };
        setCiphertext("SAMPLE_DATASET_ENCRYPTION_PREVIEW");
        setVaultQueued(true);
        setBuyerBalance(50);
        setAgentBid(demoBid);
        setAcceptedBid(demoBid);
      }
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Dataset preparation failed.");
    } finally {
      setIsPreparingDataset(false);
    }
  }

  async function loadSampleDataset() {
    const sampleContent = [
      "quarter,region,revenue_usd,projected_revenue_usd,customer_growth_percent",
      "Q1 2025,North America,12400000,13800000,8.2",
      "Q2 2025,North America,13100000,14500000,9.1",
      "Q3 2025,Europe,9700000,11200000,7.4",
      "Q4 2025,Asia Pacific,10800000,12600000,10.3",
      "Q1 2026,North America,14200000,15900000,11.2",
      "Q2 2026,Europe,11500000,13200000,9.8",
    ].join("\n");
    const sampleFiles: VaultFile[] = [{
      name: "Q3 Financials.csv",
      size: new Blob([sampleContent]).size,
      content: sampleContent,
    }];

    setFiles(sampleFiles);
    setInsight("");
    setAttestationToken("");
    setSettlementHash("");
    setSuccessMessage("");
    setErrorMessage("");
    setRateLimitAlert(false);
    await prepareFilesForVault(sampleFiles, true);
  }

  async function addFiles(selectedFiles: FileList | File[]) {
    if (isEncrypting || isValuing || isPreparingDataset) return;
    const nextFiles: VaultFile[] = [];
    const rejectedFiles: string[] = [];

    for (const file of Array.from(selectedFiles)) {
      try {
        const content = await extractVaultFileText(file);
        nextFiles.push({ name: file.name, size: file.size, content });
      } catch (error) {
        rejectedFiles.push(file.name);
        setErrorMessage(error instanceof Error ? error.message : `Unsupported or unreadable file: ${file.name}`);
      }
    }

    if (nextFiles.length) {
      const updatedFiles = [...files, ...nextFiles];
      setFiles(updatedFiles);
      setInsight("");
      setAttestationToken("");
      setSettlementHash("");
      setSuccessMessage("");
      await prepareFilesForVault(updatedFiles);
    } else if (!rejectedFiles.length) {
      setErrorMessage("");
    }
    if (rejectedFiles.length && nextFiles.length === 0) {
      setErrorMessage(`Unable to ingest file${rejectedFiles.length === 1 ? "" : "s"}: ${rejectedFiles.join(", ")}.`);
    }
  }

  async function handleEncryptPayload() {
    if (!files.length || !preparedDatasetId || isPreparingDataset || isEncrypting) return;
    setIsEncrypting(true);
    setVaultQueued(false);
    setCiphertext("");
    setAgentBid(null);
    setAcceptedBid(null);

    await new Promise<void>((resolve) => {
      const intervalId = window.setInterval(() => {
        setCiphertext((current) => `${current}${randomCiphertextChunk(64)}`.slice(-2400));
      }, 40);
      window.setTimeout(() => {
        window.clearInterval(intervalId);
        resolve();
      }, 2000);
    });

    setIsEncrypting(false);
    setVaultQueued(true);
  }

  async function requestAgentValuation() {
    if (!files.length || !preparedDatasetId || !vaultQueued || isPreparingDataset || isValuing) return;

    const fileSizeBytes = files.reduce((total, file) => total + file.size, 0);

    setIsValuing(true);
    setErrorMessage("");
    setAgentBid(null);
    setAcceptedBid(null);

    try {
      const dataset = files.map((file) => `### ${file.name}\n${file.content}`).join("\n\n");
      const response = await fetch("/api/agent-bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset,
          fileCount: files.length,
          fileSizeBytes,
        }),
      });
      const result = (await response.json()) as AgentBidResponse;
      if (!response.ok) throw new Error(result.error || "Agent valuation failed.");
      if (!result.bidAmountInUSDC || !result.justification) {
        throw new Error("The agent returned an incomplete valuation.");
      }
      setAgentBid(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Agent valuation failed.");
    } finally {
      setIsValuing(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (isEncrypting || isValuing || isPreparingDataset) return;
    void addFiles(event.dataTransfer.files);
  }

  async function handleSubmit(submittedQuery: string): Promise<boolean> {
    if (!submittedQuery.trim() || files.length === 0 || !preparedDatasetId || !vaultQueued || !acceptedBid || buyerBalance < 10) return false;

    setErrorMessage("");
    setRateLimitAlert(false);
    setSuccessMessage("");
    setInsight("");
    setAttestationToken("");
    setSettlementHash("");

    try {
      const dataset = files.map((file) => `### ${file.name}\n${file.content}`).join("\n\n");
      const response = await fetch("/api/query-tee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetId: preparedDatasetId,
          dataset,
          query: submittedQuery.trim(),
          ciphertextPreview: ciphertext,
          encryptionMode: "mock-aes-256",
          userId: walletAccountId ?? "anonymous-agent",
          agentId: walletAccountId ?? "anonymous-agent",
        }),
      });
      const result = (await response.json()) as QueryResponse;
      if (!response.ok) {
        const nextStatus = result.antiProbingCheck ?? "BLOCKED";
        setAntiProbingCheck(nextStatus);
        if (response.status === 429) {
          setRateLimitAlert(true);
          setErrorMessage(result.error || "Potential probing attack detected. Rate limit applied to protect privacy.");
        } else {
          setRateLimitAlert(false);
          setErrorMessage(result.error || "Confidential query failed.");
        }
        throw new Error(result.error || "Confidential query failed.");
      }
      if (!result.insight || !result.attestationToken) {
        throw new Error("The inference response was incomplete.");
      }

      setAntiProbingCheck(result.antiProbingCheck ?? "PASSED");
      setRateLimitAlert(false);
      setBuyerBalance((balance) => balance - 10);
      const payout = await executeDataPayout(
        providerAddress,
        acceptedBid.bidAmountInUSDC,
        result.attestationToken,
      );
      setInsight(result.insight);
      setAttestationToken(result.attestationToken);
      setSettlementHash(payout.transactionHash);
      setRunCount((count) => count + 1);
      setSuccessMessage(`Mock USDC settlement ${payout.status.toLowerCase()}.`);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Confidential query failed.");
      return false;
    }
  }

  return (
    <div className="min-h-screen bg-[#080c0d] text-[#e7eeeb]">
      <header className="border-b border-white/[0.07] bg-[#0b1011]/90">
        <div className="mx-auto flex h-[68px] max-w-[1500px] items-center justify-between px-5 sm:px-8">
          <a href="#home" className="flex items-center gap-3" aria-label="BlindSight home">
            <span className="relative grid size-8 place-items-center border border-[#a8f074]/30 bg-[#a8f074]/[0.07]">
              <span className="size-2.5 rotate-45 border border-[#b5ff82]" />
              <span className="absolute h-px w-5 bg-[#b5ff82]/60" />
            </span>
            <span className="text-[13px] font-semibold tracking-[0.16em]">BLINDSIGHT</span>
            <span className="hidden border-l border-white/10 pl-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#6c7b76] sm:block">
              Private data exchange
            </span>
          </a>

          <div className="flex items-center gap-3 sm:gap-6">
            <div className="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#a4b1ab] sm:flex">
              <span className="size-1.5 rounded-full bg-[#b5ff82] shadow-[0_0_9px_#b5ff82]" />
              TEE gateway <span className="text-[#b5ff82]">preview</span>
            </div>
            <div className="h-5 w-px bg-white/10" />
            <div
              className="hidden items-center gap-2 rounded-full border border-white/10 bg-[#0a1112]/90 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#b8c5c1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] md:flex"
              title="Background escrow settlement & frictionless session execution powered by NEAR."
            >
              <span className="size-1.5 rounded-full bg-[#7ef0a4] shadow-[0_0_8px_rgba(126,240,164,0.8)]" />
              <span>Chain Abstraction Active</span>
            </div>
            <button className="flex items-center gap-2 border border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#a4b1ab] transition hover:border-[#b5ff82]/40 hover:text-white">
              <span className="size-1.5 rounded-full bg-[#f0b66a]" />
              <span>NEAR Testnet</span>
              <span className="text-[#718079]">⌄</span>
            </button>
            {walletAccountId ? (
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center gap-2 border border-[#b5ff82]/30 bg-[#b5ff82]/[0.06] px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#dfeee4] shadow-[inset_0_0_0_1px_rgba(181,255,130,0.08)]"
                  title={walletAccountId}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#b5ff82] shadow-[0_0_9px_#b5ff82]" />
                    <span className="text-[#c8f1b6]">Connected as</span>
                  </span>
                  <span className="max-w-[150px] truncate text-[#f2f7f1]">{walletAccountId.length > 18 ? `${walletAccountId.slice(0, 8)}...${walletAccountId.slice(-8)}` : walletAccountId}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleWalletDisconnect()}
                  disabled={isWalletLoading}
                  className="border border-white/10 px-2 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#a4b1ab] transition hover:border-[#ff9a83]/35 hover:text-[#ffb5a0] disabled:cursor-wait disabled:opacity-60"
                  aria-label={`Disconnect wallet ${walletAccountId}`}
                >
                  Disconnect
                </button>
                {walletSource === "embedded" && (
                  <button
                    type="button"
                    onClick={handleExportEmbeddedWallet}
                    className="border border-[#34d399]/25 px-2 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-[#74e7b5] transition hover:border-[#34d399]/55 hover:bg-[#34d399]/[0.06]"
                    aria-label="Export embedded wallet backup key"
                  >
                    Export Key
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleWalletConnect()}
                disabled={isWalletLoading}
                className="flex items-center gap-2 border border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#a4b1ab] transition hover:border-[#72d9d0]/45 hover:text-white disabled:cursor-wait disabled:opacity-60"
              >
                <span className="size-1.5 rounded-full bg-[#72d9d0] shadow-[0_0_8px_#72d9d0]" />
                <span>{isWalletLoading ? "Connecting..." : "Connect Wallet"}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="home" className="mx-auto max-w-[1500px] px-5 pb-10 pt-8 sm:px-8 sm:pt-11">
        <section className="mb-8 flex flex-col justify-between gap-5 border-b border-white/[0.07] pb-7 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[#87958f]">
              <span className="text-[#b5ff82]">01</span>
              / Confidential intelligence
            </div>
            <h1 className="text-[clamp(30px,4vw,48px)] font-medium leading-[1.08] tracking-[-0.035em] text-[#edf3ef]">
              Insight without exposure<span className="text-[#b5ff82]">.</span>
            </h1>
            <p className="mt-3 max-w-[570px] text-sm leading-6 text-[#87958f]">
              Make private data useful. Queries route through NEAR AI Cloud; hardware isolation and attestation are mocked in this MVP.
            </p>
          </div>
          <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.1em] text-[#83918b]">
            <div>
              <div className="mb-1 text-[#54615c]">Settlement</div>
              <div className="text-[#c0cbc5]">NEAR Intents</div>
            </div>
            <span className="h-8 w-px bg-white/10" />
            <div>
              <div className="mb-1 text-[#54615c]">Enclave</div>
              <div className="flex items-center gap-2 text-[#c0cbc5]"><span className="size-1.5 rounded-full bg-[#b5ff82]" /> SGX · simulated</div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(310px,0.78fr)_minmax(0,1.65fr)]">
          <section className="min-w-0 border border-white/[0.09] bg-[#0d1314]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#b5ff82]">01</span>
                <h2 className="text-[13px] font-medium tracking-wide">Data Provider Vault</h2>
              </div>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#66736d]">Dataset intake · preview</span>
            </div>

            <div className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] text-[#bdc8c2]">Attach a text dataset for private analysis.</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#6f7c76]">Selected content is sent to the configured inference gateway.</p>
                </div>
                <span className="border border-[#f0b66a]/20 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#f0b66a]">LOCAL TEXT</span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                disabled={isEncrypting || isValuing || isPreparingDataset}
                onChange={handleFileChange}
                aria-label="Select data files"
              />
              <div
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
                }}
                onDrop={handleDrop}
                className={`group flex min-h-[220px] cursor-pointer flex-col items-center justify-center border border-dashed px-5 text-center transition ${isDragging ? "border-[#b5ff82] bg-[#b5ff82]/[0.07]" : "border-[#36433e] bg-[#0a0f10] hover:border-[#778b7e] hover:bg-[#0c1212]"}`}
                onClick={() => { if (!isEncrypting && !isValuing && !isPreparingDataset) fileInputRef.current?.click(); }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (!isEncrypting && !isValuing && !isPreparingDataset && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <span className="mb-4 grid size-11 place-items-center border border-[#b5ff82]/20 bg-[#b5ff82]/[0.06] font-mono text-xl text-[#b5ff82] transition group-hover:border-[#b5ff82]/50">
                  +
                </span>
                <span className="text-[12px] font-medium text-[#dce5df]">Drop files to attach</span>
                <span className="mt-1.5 text-[11px] text-[#78857f]">or <span className="text-[#b5ff82] underline underline-offset-2">browse your device</span></span>
                <span className="mt-5 font-mono text-[9px] uppercase tracking-[0.11em] text-[#59665f]">PDF · CSV · JSON · TXT · TSV · under 1 MB each</span>
              </div>

              <div className="mt-5 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-[#6f7c76]">
                <span>Vault contents</span>
                <span>{String(files.length).padStart(2, "0")} files</span>
              </div>
              {files.length > 0 ? (
                <ul className="mt-2 divide-y divide-white/[0.06] border-y border-white/[0.07]">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center border border-white/10 font-mono text-[9px] text-[#b5ff82]">{file.name.split(".").pop()?.slice(0, 4).toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] text-[#cbd5cf]">{file.name}</span>
                          <span className="mt-1 block font-mono text-[9px] text-[#66736d]">{formatBytes(file.size)} · loaded locally</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const remainingFiles = files.filter((_, fileIndex) => fileIndex !== index);
                          setFiles(remainingFiles);
                          setInsight("");
                          setAttestationToken("");
                          setSettlementHash("");
                          setSuccessMessage("");
                          void prepareFilesForVault(remainingFiles);
                        }}
                        disabled={isEncrypting || isValuing || isPreparingDataset}
                        className="shrink-0 px-2 py-1 font-mono text-[9px] text-[#74817b] hover:text-[#ff9a83]"
                        aria-label={`Remove ${file.name}`}
                      >
                        REMOVE
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 flex items-center gap-3 border-y border-white/[0.07] py-4">
                  <span className="grid size-8 shrink-0 place-items-center border border-white/[0.08] font-mono text-[11px] text-[#5f6d66]">--</span>
                  <div>
                    <div className="text-[11px] text-[#738079]">No datasets added</div>
                    <div className="mt-1 font-mono text-[9px] text-[#56635d]">Awaiting provider input</div>
                  </div>
                </div>
              )}

              <div className="mt-5 flex items-center gap-2 text-[10px] leading-4 text-[#6d7a73]">
                <span className="text-[#b5ff82]">◆</span>
                Demo only: the ciphertext is visual metadata; the original dataset is sent for inference.
              </div>
              <button
                type="button"
                onClick={() => void handleEncryptPayload()}
                disabled={files.length === 0 || !preparedDatasetId || isPreparingDataset || isEncrypting}
                className="mt-5 flex h-10 w-full items-center justify-center gap-2 bg-[#b5ff82] font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#111711] transition hover:bg-[#c6ff9d] disabled:cursor-not-allowed disabled:bg-[#344036] disabled:text-[#7b897d]"
              >
                <span>{isPreparingDataset ? "Validating dataset..." : isEncrypting ? "Encrypting payload locally..." : "Encrypt Payload Locally"}</span><span aria-hidden="true">{isPreparingDataset || isEncrypting ? "···" : "↗"}</span>
              </button>
              <div className="mt-3 flex justify-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[#56635d]">
                <span>{isPreparingDataset ? "Checking dataset structure and building index" : vaultQueued ? "Payload ready in local preview" : "Local encryption required to query"}</span>
              </div>
              {(isEncrypting || vaultQueued) && (
                <div className="mt-4 border border-white/[0.1] bg-black p-3 font-mono text-[9px] leading-5">
                  {isEncrypting ? (
                    <pre aria-live="polite" className="max-h-28 overflow-hidden break-all whitespace-pre-wrap text-[#b5ff82]/80">{ciphertext}</pre>
                  ) : (
                    <>
                      <div role="status" className="text-[#b5ff82]">Payload Encrypted (AES-256). Ready for TEE Transmission.</div>
                      <code className="mt-2 block max-h-24 overflow-auto break-all text-[#b5ff82]/70">{ciphertext}</code>
                    </>
                  )}
                </div>
              )}
              {vaultQueued && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => void requestAgentValuation()}
                    disabled={isValuing}
                    className="flex h-10 w-full items-center justify-center gap-2 border border-[#72d9d0]/35 bg-[#72d9d0]/[0.06] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#72d9d0] transition hover:border-[#72d9d0]/65 hover:bg-[#72d9d0]/[0.1] disabled:cursor-wait disabled:opacity-60"
                  >
                    {isValuing ? "Agent evaluating metadata..." : "Request Agent Valuation"}
                  </button>
                  {agentBid && (
                    <div className="mt-3 border border-[#f0b66a]/30 bg-[#f0b66a]/[0.05] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-[9px] uppercase tracking-[0.13em] text-[#f0b66a]">Autonomous Agent Bid</div>
                          <div className="mt-1 font-mono text-[24px] font-semibold leading-8 text-[#f3c77e]">{agentBid.bidAmountInUSDC} <span className="text-[12px]">USDC</span></div>
                        </div>
                        <div className="text-right font-mono text-[9px] leading-5 text-[#8f8775]">
                          <div>{agentBid.rowCount.toLocaleString()} estimated rows</div>
                          <div>${agentBid.ratePerRowUSDC} / row</div>
                        </div>
                      </div>
                      <p className="mt-3 text-[11px] leading-5 text-[#c5b99f]">{agentBid.justification}</p>
                      <button
                        type="button"
                        onClick={() => setAcceptedBid(agentBid)}
                        disabled={acceptedBid === agentBid}
                        className="mt-4 flex h-9 w-full items-center justify-center gap-2 bg-[#f0b66a] px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#16110a] transition hover:bg-[#f5ca91] disabled:cursor-not-allowed disabled:bg-[#61503a] disabled:text-[#c7b28f]"
                      >
                        {acceptedBid === agentBid ? "Bid Accepted · Authorized" : "Accept Bid & Authorize"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <QueryVault
            key={preparedDatasetId || "unprepared"}
            fileCount={files.length}
            queryReady={Boolean(preparedDatasetId && vaultQueued && acceptedBid && buyerBalance >= 10)}
            isPreparingDataset={isPreparingDataset}
            buyerBalance={buyerBalance}
            isDepositing={isDepositing}
            acceptedBid={acceptedBid?.bidAmountInUSDC ?? null}
            providerAddress={providerAddress}
            errorMessage={errorMessage}
            rateLimitAlert={rateLimitAlert}
            insight={insight}
            antiProbingCheck={antiProbingCheck}
            attestationToken={attestationToken}
            transactionHash={settlementHash}
            runCount={runCount}
            onProviderAddressChange={setProviderAddress}
            onDeposit={() => void handleDeposit()}
            onLoadSampleDataset={loadSampleDataset}
            onRunQuery={handleSubmit}
          />
        </div>

        <footer className="mt-6 flex flex-col gap-3 border-t border-white/[0.07] pt-4 font-mono text-[9px] uppercase tracking-[0.1em] text-[#58665f] sm:flex-row sm:items-center sm:justify-between">
          <span>BlindSight <span className="mx-2 text-[#35413b]">/</span> Confidential data market</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>NEAR Intents <span className="text-[#f0b66a]">mocked</span></span>
            <span>TEE verification <span className="text-[#f0b66a]">mocked</span></span>
            <span>Build <span className="text-[#a1ada6]">MVP.01</span></span>
          </div>
        </footer>
      </main>
      {successMessage && settlementHash && (
        <div role="status" className="fixed bottom-5 right-5 z-20 w-[min(420px,calc(100vw-40px))] border border-[#b5ff82]/30 bg-[#111a14] p-4 shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 text-[11px] font-medium text-[#b5ff82]">
            <span className="grid size-5 place-items-center border border-[#b5ff82]/30">✓</span>
            {successMessage}
          </div>
          <code className="mt-2 block break-all font-mono text-[10px] leading-5 text-[#9ba99f]">{settlementHash}</code>
          <span className="mt-2 block font-mono text-[9px] uppercase tracking-[0.1em] text-[#738079]">Synthetic hash · no funds moved</span>
          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            className="absolute right-3 top-3 px-1 font-mono text-[12px] text-[#738079] hover:text-white"
            aria-label="Dismiss settlement message"
          >
            ×
          </button>
        </div>
      )}
      {walletError && !isConnectModalOpen && (
        <div
          role="alert"
          className="fixed bottom-5 left-5 z-20 flex max-w-[min(420px,calc(100vw-40px))] items-start gap-4 border border-[#ff9a83]/25 bg-[#1a1111] px-4 py-3 text-xs leading-5 text-[#ffb5a0] shadow-2xl shadow-black/40"
        >
          <span>{walletError}</span>
          <button
            type="button"
            onClick={() => setWalletError(null)}
            aria-label="Dismiss wallet error"
            className="font-mono text-sm text-[#ffb5a0]/70 hover:text-[#ffb5a0]"
          >
            ×
          </button>
        </div>
      )}
      {walletSuccessMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-20 w-[min(460px,calc(100vw-40px))] border border-[#34d399]/35 bg-[#0d1b16] p-4 text-xs leading-5 text-[#a7f3d0] shadow-2xl shadow-black/40"
        >
          <div className="flex items-start justify-between gap-4">
            <span className="break-all">{walletSuccessMessage}</span>
            <button
              type="button"
              onClick={() => setWalletSuccessMessage("")}
              aria-label="Dismiss wallet created message"
              className="shrink-0 font-mono text-sm text-[#a7f3d0]/70 hover:text-[#a7f3d0]"
            >
              ×
            </button>
          </div>
        </div>
      )}
      {backupKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setBackupKey(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-key-title"
            className="relative w-full max-w-[520px] border border-white/10 bg-[#0B0F17] p-5 shadow-[0_24px_100px_rgba(0,0,0,0.65)] sm:p-7"
          >
            <button
              type="button"
              onClick={() => setBackupKey(null)}
              aria-label="Close backup key dialog"
              className="absolute right-4 top-4 grid size-8 place-items-center border border-white/10 text-[#98a49f] transition hover:border-white/25 hover:text-white"
            >
              ×
            </button>
            <h2 id="backup-key-title" className="pr-10 text-xl font-medium text-white">
              Export Backup Key
            </h2>
            <p className="mt-2 text-xs leading-5 text-[#9ba9a1]">
              Import this key in another browser to access the same implicit account.
            </p>
            <div className="mt-5 border border-[#f0b66a]/25 bg-[#f0b66a]/[0.06] p-3 text-xs leading-5 text-[#f0c98e]">
              Anyone with this private key can control your wallet. Store it securely and never share it.
            </div>
            <textarea
              readOnly
              aria-label="Embedded wallet private key"
              value={backupKey}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-4 min-h-20 w-full resize-none border border-white/10 bg-[#080c0d] p-3 font-mono text-xs leading-5 text-[#d5dfd9] outline-none focus:border-[#34d399]/40"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span role="status" className="text-xs text-[#74e7b5]">
                {backupKeyCopied ? "Backup key copied." : ""}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyBackupKey()}
                className="border border-[#34d399]/35 bg-[#34d399]/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#74e7b5] transition hover:border-[#54edb0]/70"
              >
                Copy key
              </button>
            </div>
          </section>
        </div>
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
