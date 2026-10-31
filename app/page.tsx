"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Image from "next/image";
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
  success?: boolean;
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

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};

  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    console.error("Non-JSON response received:", text);
    throw new Error("Server returned an invalid response. Please try again.");
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Server returned an invalid response. Please try again.");
  }
  return data as Record<string, unknown>;
}

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

    const result = (await readJsonResponse(response)) as VaultParseResponse;
    if (!response.ok || !result.success || typeof result.text !== "string") {
      throw new Error(result.error || `Unable to ingest ${file.name}.`);
    }

    return result.text;
  }

  async function prepareFilesForVault(datasetFiles: VaultFile[]) {
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
      const result = (await readJsonResponse(response)) as DatasetPreparationResponse;
      if (!response.ok || !result.datasetId) {
        throw new Error(result.error || "Dataset preparation failed.");
      }
      setPreparedDatasetId(result.datasetId);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Dataset preparation failed.");
    } finally {
      setIsPreparingDataset(false);
    }
  }

  async function loadSampleDataset() {
    const sampleContent = `
BLINDSIGHT CONFIDENTIAL DATASET - FINANCIAL & MARKET DEMAND REPORT

1. Performance Summary:
   - Total Revenue: $4,200,000 (+34% YoY)
   - TEE Enclave Query Volume: 1,420,000 queries processed
   - Active Vault Monetizers: 850 Enterprise Accounts

2. Privacy & Anti-Probing Metrics:
   - Total Probing Attacks Blocked: 14,200 requests
   - Differential Privacy Budget (ε): 0.5 per session
   - Attestation Status: Verified Active (AMD SEV-SNP)
`.trim();
    const sampleFiles: VaultFile[] = [{
      name: "Q3_Financials_Sample.pdf",
      size: 148520,
      content: sampleContent,
    }];

    setFiles(sampleFiles);
    setPreparedDatasetId(window.crypto.randomUUID());
    setIsPreparingDataset(false);
    setVaultQueued(true);
    setCiphertext("SAMPLE_DATASET_PREVIEW");
    const demoBid: AgentBid = {
      bidAmountInUSDC: "0.05",
      rowCount: 6,
      ratePerRowUSDC: "0.0083",
      justification: "Fixed sample bid for the hackathon judge demo.",
    };
    setAgentBid(demoBid);
    setAcceptedBid(demoBid);
    setBuyerBalance(50);
    setInsight("");
    setAttestationToken("");
    setSettlementHash("");
    setSuccessMessage("");
    setErrorMessage("");
    setRateLimitAlert(false);
    setAntiProbingCheck("PASSED");
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
      const result = (await readJsonResponse(response)) as AgentBidResponse;
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
      const result = (await readJsonResponse(response)) as QueryResponse;
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
    <div className="min-h-screen text-[#F0FDF4]">
      <header className="border-b border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl">
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
            <div className="hidden items-center gap-2 text-[11px] text-[#A7B9B0] sm:flex">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Query gateway preview
            </div>
            <div className="h-5 w-px bg-[#047857]" />
            <div
              className="hidden items-center gap-2 border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1.5 text-[10px] text-emerald-400 md:flex"
              title="NEAR settlement is simulated in this prototype."
            >
              <span className="size-1.5 rounded-full bg-[#34D399]" />
              <span>NEAR testnet · preview</span>
            </div>
            {walletAccountId ? (
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center gap-2 border border-[#34D399]/40 bg-[#0B0F17]/80 backdrop-blur-xl px-2.5 py-2 text-[10px] text-[#F0FDF4]"
                  title={walletAccountId}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[#A7B9B0]">Wallet</span>
                  </span>
                  <span className="max-w-[150px] truncate">{walletAccountId.length > 18 ? `${walletAccountId.slice(0, 8)}...${walletAccountId.slice(-8)}` : walletAccountId}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleWalletDisconnect()}
                  disabled={isWalletLoading}
                  className="border border-emerald-500/20 px-2 py-2 text-[10px] text-[#A7B9B0] transition hover:border-[#F87171]/60 hover:text-[#FCA5A5] disabled:cursor-wait disabled:opacity-60"
                  aria-label={`Disconnect wallet ${walletAccountId}`}
                >
                  Disconnect
                </button>
                {walletSource === "embedded" && (
                  <button
                    type="button"
                    onClick={handleExportEmbeddedWallet}
                    className="border border-emerald-500/30 bg-emerald-950/40 px-2 py-2 text-[10px] text-emerald-400 transition hover:border-emerald-500/40"
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
              <span className="mt-2 block text-[12px] text-[#7D9187]">
                Prototype note: dataset text is sent to NEAR AI Cloud; enclave and settlement steps are simulated.
              </span>
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

        <div className="grid gap-5 xl:grid-cols-[minmax(310px,0.78fr)_minmax(0,1.65fr)]">
          <section className="min-w-0 border border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl transition-colors hover:border-emerald-500/40">
            <div className="flex items-center justify-between border-b border-emerald-500/20 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="size-2 rotate-45 border border-[#10B981]" />
                <h2 className="text-[14px] font-medium">Your source files</h2>
              </div>
              <span className="text-[10px] text-[#A7B9B0]">Dataset intake</span>
            </div>

            <div className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] text-[#E2F8EC]">Add a file to begin.</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#A7B9B0]">Its extracted text is sent to the configured inference service.</p>
                </div>
                <span className="border border-[#34D399]/35 px-2 py-1 text-[10px] text-[#D1FAE5]">Text preview</span>
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
                className={`group flex min-h-[220px] cursor-pointer flex-col items-center justify-center border border-dashed px-5 text-center transition-colors ${isDragging ? "border-[#10B981] bg-[#10B981]/[0.06]" : "border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl hover:border-[#34D399] hover:bg-emerald-950/40"}`}
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
                <span className="mb-4 grid size-11 place-items-center border border-[#34D399]/45 bg-[#34D399]/[0.06] text-2xl text-[#10B981] transition group-hover:border-[#10B981]/70">
                  +
                </span>
                <span className="text-[13px] font-medium text-[#F0FDF4]">Drop files here</span>
                <span className="mt-1.5 text-[12px] text-[#A7B9B0]">or <span className="text-[#10B981] underline underline-offset-2">browse your device</span></span>
                <span className="mt-5 text-[10px] text-[#7D9187]">PDF, CSV, JSON, text, code, and more</span>
              </div>

              <div className="mt-5 flex items-center justify-between text-[11px] text-[#A7B9B0]">
                <span>Attached files</span>
                <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
              </div>
              {files.length > 0 ? (
                <ul className="mt-2 divide-y divide-white/[0.06] border-y border-white/[0.07]">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center border border-emerald-500/20 text-[10px] text-[#10B981]">{file.name.split(".").pop()?.slice(0, 4).toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] text-[#D1FAE5]">{file.name}</span>
                          <span className="mt-1 block text-[10px] text-[#A7B9B0]">{formatBytes(file.size)} · ready</span>
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
                        className="shrink-0 px-2 py-1 text-[10px] text-[#A7B9B0] hover:text-[#FCA5A5]"
                        aria-label={`Remove ${file.name}`}
                      >
                        REMOVE
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 flex items-center gap-3 border-y border-emerald-500/20 py-4">
                  <span className="grid size-8 shrink-0 place-items-center border border-emerald-500/20 text-[11px] text-[#7D9187]">+</span>
                  <div>
                    <div className="text-[12px] text-[#D1FAE5]">No files yet</div>
                    <div className="mt-1 text-[11px] text-[#7D9187]">Your dataset will appear here.</div>
                  </div>
                </div>
              )}

              <div className="mt-5 border-l-2 border-[#10B981]/55 pl-3 text-[11px] leading-5 text-[#A7B9B0]">
                This preview does not encrypt the source. File text is sent for inference.
              </div>
              <button
                type="button"
                onClick={() => void handleEncryptPayload()}
                disabled={files.length === 0 || !preparedDatasetId || isPreparingDataset || isEncrypting}
                className="mt-5 flex h-11 w-full items-center justify-center gap-2 bg-emerald-500 shadow-lg shadow-emerald-500/20 text-[12px] font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-[#047857] disabled:text-[#A7B9B0]"
              >
                <span>{isPreparingDataset ? "Preparing dataset..." : isEncrypting ? "Preparing preview..." : "Prepare dataset"}</span><span aria-hidden="true">{isPreparingDataset || isEncrypting ? "···" : "→"}</span>
              </button>
              <div className="mt-3 flex justify-center gap-2 text-[10px] text-[#7D9187]">
                <span>{isPreparingDataset ? "Checking the dataset structure" : vaultQueued ? "Dataset preview is ready" : "Prepare the dataset to continue"}</span>
              </div>
              {(isEncrypting || vaultQueued) && (
                <div className="mt-4 border border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl p-3 text-[10px] leading-5">
                  {isEncrypting ? (
                    <pre aria-live="polite" className="max-h-28 overflow-hidden break-all whitespace-pre-wrap text-[#10B981]/80">{ciphertext}</pre>
                  ) : (
                    <>
                      <div role="status" className="text-[#10B981]">Encryption preview ready. No source encryption is performed.</div>
                      <code className="mt-2 block max-h-24 overflow-auto break-all text-[#34D399]/80">{ciphertext}</code>
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
                    className="flex h-10 w-full items-center justify-center gap-2 border border-[#34D399]/40 bg-[#34D399]/[0.06] text-[12px] font-medium text-[#E2F8EC] transition hover:border-[#10B981]/60 hover:bg-[#34D399]/[0.1] disabled:cursor-wait disabled:opacity-60"
                  >
                    {isValuing ? "Agent evaluating metadata..." : "Request Agent Valuation"}
                  </button>
                  {agentBid && (
                    <div className="mt-3 border border-emerald-500/20 bg-emerald-950/40 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] text-[#A7B9B0]">Agent bid · demo</div>
                          <div className="mt-1 text-[25px] font-medium leading-8 text-[#F0FDF4]">{agentBid.bidAmountInUSDC} <span className="text-[12px] text-[#A7B9B0]">USDC</span></div>
                        </div>
                        <div className="text-right text-[10px] leading-5 text-[#A7B9B0]">
                          <div>{agentBid.rowCount.toLocaleString()} estimated rows</div>
                          <div>${agentBid.ratePerRowUSDC} / row</div>
                        </div>
                      </div>
                      <p className="mt-3 text-[12px] leading-5 text-[#D1FAE5]">{agentBid.justification}</p>
                      <button
                        type="button"
                        onClick={() => setAcceptedBid(agentBid)}
                        disabled={acceptedBid === agentBid}
                        className="mt-4 flex h-10 w-full items-center justify-center gap-2 bg-emerald-500 shadow-lg shadow-emerald-500/20 px-3 text-[12px] font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-[#047857] disabled:text-[#A7B9B0]"
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
            onDismissError={() => {
              setErrorMessage("");
              setRateLimitAlert(false);
            }}
            onDeposit={() => void handleDeposit()}
            onLoadSampleDataset={loadSampleDataset}
            onRunQuery={handleSubmit}
          />
        </div>

        <footer className="mt-7 flex flex-col gap-3 border-t border-emerald-500/20 pt-4 text-[10px] text-[#7D9187] sm:flex-row sm:items-center sm:justify-between">
          <span>BlindSight · Confidential data marketplace</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>NEAR settlement · simulated</span>
            <span>TEE verification · simulated</span>
            <span>Prototype build</span>
          </div>
        </footer>
      </main>
      {successMessage && settlementHash && (
        <div role="status" className="fixed bottom-5 right-5 z-20 w-[min(420px,calc(100vw-40px))] border border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl p-4 shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 text-[12px] font-medium text-[#10B981]">
            <span className="grid size-5 place-items-center border border-emerald-500/20">✓</span>
            {successMessage}
          </div>
          <code className="mt-2 block break-all font-mono text-[10px] leading-5 text-[#A7B9B0]">{settlementHash}</code>
          <span className="mt-2 block text-[10px] text-[#A7B9B0]">Synthetic hash · no funds moved</span>
          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            className="absolute right-3 top-3 px-1 text-[14px] text-[#A7B9B0] hover:text-[#F0FDF4]"
            aria-label="Dismiss settlement message"
          >
            ×
          </button>
        </div>
      )}
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
            className="relative w-full max-w-[520px] border border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl p-5 shadow-[0_24px_100px_rgba(0,0,0,0.65)] sm:p-7"
          >
            <button
              type="button"
              onClick={() => setBackupKey(null)}
              aria-label="Close backup key dialog"
              className="absolute right-4 top-4 grid size-8 place-items-center border border-emerald-500/20 text-[#A7B9B0] transition hover:border-[#34D399] hover:text-[#F0FDF4]"
            >
              ×
            </button>
            <h2 id="backup-key-title" className="pr-10 font-serif text-xl font-medium text-[#F0FDF4]">
              Export Backup Key
            </h2>
            <p className="mt-2 text-xs leading-5 text-[#A7B9B0]">
              Import this key in another browser to access the same implicit account.
            </p>
            <div className="mt-5 border border-[#F59E0B]/60 bg-[#241C0E] p-3 text-xs leading-5 text-[#FDE68A]">
              Anyone with this private key can control your wallet. Store it securely and never share it.
            </div>
            <textarea
              readOnly
              aria-label="Embedded wallet private key"
              value={backupKey}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-4 min-h-20 w-full resize-none border border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl p-3 font-mono text-xs leading-5 text-[#E2F8EC] outline-none focus:border-[#10B981]/60"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span role="status" className="text-xs text-[#10B981]">
                {backupKeyCopied ? "Backup key copied." : ""}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyBackupKey()}
                className="bg-emerald-500 px-4 py-2 text-[11px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400"
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
