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
      const result = (await readJsonResponse(response)) as DatasetPreparationResponse;
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
    <div className="min-h-screen bg-[#111914] text-[#e5e8dc]">
      <header className="border-b border-[#39463d] bg-[#111914]">
        <div className="mx-auto flex h-[68px] max-w-[1500px] items-center justify-between px-5 sm:px-8">
          <a href="#home" className="flex items-center gap-3" aria-label="BlindSight home">
            <span className="relative grid size-8 place-items-center border border-[#9dae8c]/45 bg-[#9dae8c]/[0.08]">
              <span className="size-2.5 rotate-45 border border-[#c9f27a]" />
              <span className="absolute h-px w-5 bg-[#c9f27a]/65" />
            </span>
            <span className="text-[13px] font-semibold tracking-[0.1em]">BlindSight</span>
            <span className="hidden border-l border-[#39463d] pl-3 text-[11px] text-[#a4afa0] sm:block">
              Private data, useful answers
            </span>
          </a>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden items-center gap-2 text-[11px] text-[#a4afa0] sm:flex">
              <span className="size-1.5 rounded-full bg-[#c9f27a]" />
              Query gateway preview
            </div>
            <div className="h-5 w-px bg-[#39463d]" />
            <div
              className="hidden items-center gap-2 border border-[#39463d] bg-[#18221c] px-2.5 py-1.5 text-[10px] text-[#b7c0b1] md:flex"
              title="NEAR settlement is simulated in this prototype."
            >
              <span className="size-1.5 rounded-full bg-[#9dae8c]" />
              <span>NEAR testnet · preview</span>
            </div>
            {walletAccountId ? (
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center gap-2 border border-[#9dae8c]/40 bg-[#18221c] px-2.5 py-2 text-[10px] text-[#e5e8dc]"
                  title={walletAccountId}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-[#c9f27a]" />
                    <span className="text-[#a4afa0]">Wallet</span>
                  </span>
                  <span className="max-w-[150px] truncate">{walletAccountId.length > 18 ? `${walletAccountId.slice(0, 8)}...${walletAccountId.slice(-8)}` : walletAccountId}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleWalletDisconnect()}
                  disabled={isWalletLoading}
                  className="border border-[#39463d] px-2 py-2 text-[10px] text-[#a4afa0] transition hover:border-[#c18d7d]/60 hover:text-[#e3b2a1] disabled:cursor-wait disabled:opacity-60"
                  aria-label={`Disconnect wallet ${walletAccountId}`}
                >
                  Disconnect
                </button>
                {walletSource === "embedded" && (
                  <button
                    type="button"
                    onClick={handleExportEmbeddedWallet}
                    className="border border-[#9dae8c]/35 px-2 py-2 text-[10px] text-[#c9f27a] transition hover:border-[#c9f27a]/65 hover:bg-[#c9f27a]/[0.06]"
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
                className="flex items-center gap-2 border border-[#9dae8c]/55 bg-[#c9f27a] px-3 py-2 text-[11px] font-medium text-[#182018] transition hover:bg-[#d9f995] disabled:cursor-wait disabled:opacity-60"
              >
                <span>{isWalletLoading ? "Connecting..." : "Connect Wallet"}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="home" className="mx-auto max-w-[1420px] px-5 pb-12 pt-9 sm:px-8 sm:pt-12">
        <section className="mb-9 grid gap-8 border-b border-[#39463d] pb-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:items-end">
          <div>
            <p className="mb-4 text-[12px] text-[#a4afa0]">A private data workspace</p>
            <h1 className="max-w-[780px] font-serif text-[clamp(42px,7vw,82px)] leading-[0.98] tracking-[-0.045em] text-[#e5e8dc]">
              Questions out.
              <br />
              Files stay in<span className="text-[#c9f27a]">.</span>
            </h1>
            <p className="mt-5 max-w-[540px] text-[14px] leading-6 text-[#a4afa0]">
              Ask for the insight you need. Keep the source on your side.
              <span className="mt-2 block text-[12px] text-[#839080]">
                Prototype note: dataset text is sent to NEAR AI Cloud; enclave and settlement steps are simulated.
              </span>
            </p>
          </div>
          <div aria-hidden="true" className="hidden min-h-[150px] items-end justify-end lg:flex">
            <svg viewBox="0 0 360 150" fill="none" className="w-full max-w-[370px] text-[#9dae8c]">
              <path d="M56 78h110m28 0h110" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5" />
              <path d="m157 73 9 5-9 5m46-10-9 5 9 5" stroke="#c9f27a" strokeWidth="1.5" />
              <rect x="14" y="34" width="70" height="88" rx="1" stroke="currentColor" strokeOpacity=".65" />
              <path d="M29 56h39M29 68h31M29 80h34M29 92h23" stroke="currentColor" strokeOpacity=".65" />
              <circle cx="180" cy="78" r="31" stroke="currentColor" strokeOpacity=".7" />
              <circle cx="180" cy="78" r="20" stroke="#c9f27a" strokeOpacity=".75" />
              <path d="M174 78h12m-6-6v12" stroke="#c9f27a" strokeWidth="1.4" />
              <rect x="276" y="45" width="70" height="66" rx="1" stroke="currentColor" strokeOpacity=".65" />
              <path d="M291 64h39m-39 12h32m-32 12h24" stroke="currentColor" strokeOpacity=".65" />
              <text x="14" y="139" fill="currentColor" fontSize="9">SOURCE</text>
              <text x="151" y="128" fill="currentColor" fontSize="9">PRIVATE QUERY</text>
              <text x="276" y="128" fill="currentColor" fontSize="9">ANSWER</text>
            </svg>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(310px,0.78fr)_minmax(0,1.65fr)]">
          <section className="min-w-0 border border-[#39463d] bg-[#18221c]">
            <div className="flex items-center justify-between border-b border-[#39463d] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="size-2 rotate-45 border border-[#c9f27a]" />
                <h2 className="text-[14px] font-medium">Your source files</h2>
              </div>
              <span className="text-[10px] text-[#a4afa0]">Dataset intake</span>
            </div>

            <div className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] text-[#d3d9cd]">Add a file to begin.</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#a4afa0]">Its extracted text is sent to the configured inference service.</p>
                </div>
                <span className="border border-[#9dae8c]/35 px-2 py-1 text-[10px] text-[#b7c0b1]">Text preview</span>
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
                className={`group flex min-h-[220px] cursor-pointer flex-col items-center justify-center border border-dashed px-5 text-center transition-colors ${isDragging ? "border-[#c9f27a] bg-[#c9f27a]/[0.06]" : "border-[#526052] bg-[#111914] hover:border-[#9dae8c] hover:bg-[#1d2921]"}`}
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
                <span className="mb-4 grid size-11 place-items-center border border-[#9dae8c]/45 bg-[#9dae8c]/[0.06] text-2xl text-[#c9f27a] transition group-hover:border-[#c9f27a]/70">
                  +
                </span>
                <span className="text-[13px] font-medium text-[#e5e8dc]">Drop files here</span>
                <span className="mt-1.5 text-[12px] text-[#a4afa0]">or <span className="text-[#c9f27a] underline underline-offset-2">browse your device</span></span>
                <span className="mt-5 text-[10px] text-[#839080]">PDF, CSV, JSON, text, code, and more</span>
              </div>

              <div className="mt-5 flex items-center justify-between text-[11px] text-[#a4afa0]">
                <span>Attached files</span>
                <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
              </div>
              {files.length > 0 ? (
                <ul className="mt-2 divide-y divide-white/[0.06] border-y border-white/[0.07]">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center border border-[#39463d] text-[10px] text-[#c9f27a]">{file.name.split(".").pop()?.slice(0, 4).toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] text-[#cbd5cf]">{file.name}</span>
                          <span className="mt-1 block text-[10px] text-[#a4afa0]">{formatBytes(file.size)} · ready</span>
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
                        className="shrink-0 px-2 py-1 text-[10px] text-[#a4afa0] hover:text-[#e3b2a1]"
                        aria-label={`Remove ${file.name}`}
                      >
                        REMOVE
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 flex items-center gap-3 border-y border-[#39463d] py-4">
                  <span className="grid size-8 shrink-0 place-items-center border border-[#39463d] text-[11px] text-[#839080]">+</span>
                  <div>
                    <div className="text-[12px] text-[#c4cbbf]">No files yet</div>
                    <div className="mt-1 text-[11px] text-[#839080]">Your dataset will appear here.</div>
                  </div>
                </div>
              )}

              <div className="mt-5 border-l-2 border-[#c9f27a]/55 pl-3 text-[11px] leading-5 text-[#a4afa0]">
                This preview does not encrypt the source. File text is sent for inference.
              </div>
              <button
                type="button"
                onClick={() => void handleEncryptPayload()}
                disabled={files.length === 0 || !preparedDatasetId || isPreparingDataset || isEncrypting}
                className="mt-5 flex h-11 w-full items-center justify-center gap-2 bg-[#c9f27a] text-[12px] font-semibold text-[#182018] transition hover:bg-[#d9f995] disabled:cursor-not-allowed disabled:bg-[#39463d] disabled:text-[#a4afa0]"
              >
                <span>{isPreparingDataset ? "Preparing dataset..." : isEncrypting ? "Preparing preview..." : "Prepare dataset"}</span><span aria-hidden="true">{isPreparingDataset || isEncrypting ? "···" : "→"}</span>
              </button>
              <div className="mt-3 flex justify-center gap-2 text-[10px] text-[#839080]">
                <span>{isPreparingDataset ? "Checking the dataset structure" : vaultQueued ? "Dataset preview is ready" : "Prepare the dataset to continue"}</span>
              </div>
              {(isEncrypting || vaultQueued) && (
                <div className="mt-4 border border-[#39463d] bg-[#111914] p-3 text-[10px] leading-5">
                  {isEncrypting ? (
                    <pre aria-live="polite" className="max-h-28 overflow-hidden break-all whitespace-pre-wrap text-[#c9f27a]/80">{ciphertext}</pre>
                  ) : (
                    <>
                      <div role="status" className="text-[#c9f27a]">Encryption preview ready. No source encryption is performed.</div>
                      <code className="mt-2 block max-h-24 overflow-auto break-all text-[#9dae8c]/80">{ciphertext}</code>
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
                    className="flex h-10 w-full items-center justify-center gap-2 border border-[#9dae8c]/40 bg-[#9dae8c]/[0.06] text-[12px] font-medium text-[#d3d9cd] transition hover:border-[#c9f27a]/60 hover:bg-[#9dae8c]/[0.1] disabled:cursor-wait disabled:opacity-60"
                  >
                    {isValuing ? "Agent evaluating metadata..." : "Request Agent Valuation"}
                  </button>
                  {agentBid && (
                    <div className="mt-3 border border-[#526052] bg-[#1d2921] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] text-[#a4afa0]">Agent bid · demo</div>
                          <div className="mt-1 text-[25px] font-medium leading-8 text-[#e5e8dc]">{agentBid.bidAmountInUSDC} <span className="text-[12px] text-[#a4afa0]">USDC</span></div>
                        </div>
                        <div className="text-right text-[10px] leading-5 text-[#a4afa0]">
                          <div>{agentBid.rowCount.toLocaleString()} estimated rows</div>
                          <div>${agentBid.ratePerRowUSDC} / row</div>
                        </div>
                      </div>
                      <p className="mt-3 text-[12px] leading-5 text-[#c4cbbf]">{agentBid.justification}</p>
                      <button
                        type="button"
                        onClick={() => setAcceptedBid(agentBid)}
                        disabled={acceptedBid === agentBid}
                        className="mt-4 flex h-10 w-full items-center justify-center gap-2 bg-[#c9f27a] px-3 text-[12px] font-semibold text-[#182018] transition hover:bg-[#d9f995] disabled:cursor-not-allowed disabled:bg-[#39463d] disabled:text-[#a4afa0]"
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

        <footer className="mt-7 flex flex-col gap-3 border-t border-[#39463d] pt-4 text-[10px] text-[#839080] sm:flex-row sm:items-center sm:justify-between">
          <span>BlindSight · Confidential data marketplace</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>NEAR settlement · simulated</span>
            <span>TEE verification · simulated</span>
            <span>Prototype build</span>
          </div>
        </footer>
      </main>
      {successMessage && settlementHash && (
        <div role="status" className="fixed bottom-5 right-5 z-20 w-[min(420px,calc(100vw-40px))] border border-[#526052] bg-[#18221c] p-4 shadow-2xl shadow-black/40">
          <div className="flex items-center gap-2 text-[12px] font-medium text-[#c9f27a]">
            <span className="grid size-5 place-items-center border border-[#526052]">✓</span>
            {successMessage}
          </div>
          <code className="mt-2 block break-all font-mono text-[10px] leading-5 text-[#9ba99f]">{settlementHash}</code>
          <span className="mt-2 block text-[10px] text-[#a4afa0]">Synthetic hash · no funds moved</span>
          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            className="absolute right-3 top-3 px-1 text-[14px] text-[#a4afa0] hover:text-[#e5e8dc]"
            aria-label="Dismiss settlement message"
          >
            ×
          </button>
        </div>
      )}
      {walletError && !isConnectModalOpen && (
        <div
          role="alert"
          className="fixed bottom-5 left-5 z-20 flex max-w-[min(420px,calc(100vw-40px))] items-start gap-4 border border-[#9e6d60]/50 bg-[#2b211e] px-4 py-3 text-xs leading-5 text-[#e3b2a1] shadow-2xl shadow-black/40"
        >
          <span>{walletError}</span>
          <button
            type="button"
            onClick={() => setWalletError(null)}
            aria-label="Dismiss wallet error"
            className="text-sm text-[#e3b2a1]/70 hover:text-[#e3b2a1]"
          >
            ×
          </button>
        </div>
      )}
      {walletSuccessMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-20 w-[min(460px,calc(100vw-40px))] border border-[#526052] bg-[#1d2921] p-4 text-xs leading-5 text-[#d3d9cd] shadow-2xl shadow-black/40"
        >
          <div className="flex items-start justify-between gap-4">
            <span className="break-all">{walletSuccessMessage}</span>
            <button
              type="button"
              onClick={() => setWalletSuccessMessage("")}
              aria-label="Dismiss wallet created message"
              className="shrink-0 text-sm text-[#a4afa0] hover:text-[#e5e8dc]"
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
            className="relative w-full max-w-[520px] border border-[#526052] bg-[#18221c] p-5 shadow-[0_24px_100px_rgba(0,0,0,0.65)] sm:p-7"
          >
            <button
              type="button"
              onClick={() => setBackupKey(null)}
              aria-label="Close backup key dialog"
              className="absolute right-4 top-4 grid size-8 place-items-center border border-[#39463d] text-[#a4afa0] transition hover:border-[#9dae8c] hover:text-[#e5e8dc]"
            >
              ×
            </button>
            <h2 id="backup-key-title" className="pr-10 font-serif text-xl font-medium text-[#e5e8dc]">
              Export Backup Key
            </h2>
            <p className="mt-2 text-xs leading-5 text-[#a4afa0]">
              Import this key in another browser to access the same implicit account.
            </p>
            <div className="mt-5 border border-[#9d7356]/60 bg-[#34261d] p-3 text-xs leading-5 text-[#f0c99a]">
              Anyone with this private key can control your wallet. Store it securely and never share it.
            </div>
            <textarea
              readOnly
              aria-label="Embedded wallet private key"
              value={backupKey}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-4 min-h-20 w-full resize-none border border-[#39463d] bg-[#111914] p-3 font-mono text-xs leading-5 text-[#d3d9cd] outline-none focus:border-[#c9f27a]/60"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span role="status" className="text-xs text-[#c9f27a]">
                {backupKeyCopied ? "Backup key copied." : ""}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyBackupKey()}
                className="bg-[#c9f27a] px-4 py-2 text-[11px] font-medium text-[#182018] transition hover:bg-[#d9f995]"
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
