"use client";

import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import PaymentAudit from "@/components/PaymentAudit";
import { WalletContext } from "@/components/WalletProvider";
import type { AuditLogEntry } from "@/lib/auditLog";
import { DEMO_VAULTS, type MarketplaceVault } from "@/lib/demoVaults";
import { isValidNearAccountId } from "@/lib/nearAccount";
import { extractTransactionHash, transferNear } from "@/lib/near-transfers";
import { getTransactionExplorerUrl, getTreasuryExplorerUrl } from "@/lib/paymentConfig";

type QueryVaultProps = {
  providerAddress: string;
  onProviderAddressChange: (address: string) => void;
  nearAccountId: string | null;
  walletBalanceNear: string | null;
  walletBalanceError: string | null;
  treasuryAccount: string;
  auditLog: AuditLogEntry[];
  activeTab: VaultTab;
  onTabChange: (tab: VaultTab) => void;
  onAuditLog: (message: string, txHash?: string) => void;
};

export type VaultTab = "gateway" | "publish" | "explorer" | "audit";

export const VAULT_TABS: { id: VaultTab; label: string }[] = [
  { id: "gateway", label: "Query Gateway" },
  { id: "publish", label: "Publish Vault" },
  { id: "explorer", label: "Vault Explorer" },
  { id: "audit", label: "Audit Log" },
];

type QueryStage =
  | "idle"
  | "signing"
  | "verifying"
  | "confirmed"
  | "inferring"
  | "ready"
  | "error";

type VerifiedPaymentView = {
  txHash: string;
  amountNear: string;
  payerAccountId: string;
  receiverId: string;
  blockHeight: number | null;
  explorerUrl: string;
};

type QueryExecution = {
  vault: MarketplaceVault;
  submittedQuery: string;
  payerAccountId: string;
  payment: VerifiedPaymentView;
};

type DraftFile = {
  id: string;
  name: string;
  size: number;
  content: string;
};

type VaultAnswer = {
  vaultTitle: string;
  priceNear: string;
  insight: string;
  attestationToken: string;
  attestationSimulated: boolean;
  onChainTransactionHash: string;
  amountNear: string;
  receiverId: string;
  blockHeight: number | null;
  model: string;
  inferenceProvider: string;
};

const QUERY_SUGGESTIONS = [
  "Summarize the headline metrics",
  "What are the biggest risks?",
  "Show the strongest growth signal",
];

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name: string) {
  return name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "FILE";
}

function normalizePrice(raw: string) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0.1";
  return String(Number(parsed.toFixed(4)));
}

function estimateRows(dataset: string) {
  const records = dataset.split("\n").filter((line) => line.trim().length > 0).length;
  return Math.max(1, records);
}

function toVerifiedPayment(
  payload: unknown,
  fallbackTxHash: string,
  payerAccountId: string,
): VerifiedPaymentView {
  const record = typeof payload === "object" && payload !== null
    ? payload as Record<string, unknown>
    : {};
  const txHash = typeof record.txHash === "string" ? record.txHash : fallbackTxHash;
  return {
    txHash,
    amountNear: typeof record.amountNear === "string" ? record.amountNear : "",
    payerAccountId: typeof record.payerAccountId === "string"
      ? record.payerAccountId
      : payerAccountId,
    receiverId: typeof record.receiverId === "string" ? record.receiverId : "",
    blockHeight: typeof record.blockHeight === "number" ? record.blockHeight : null,
    explorerUrl: getTransactionExplorerUrl(txHash),
  };
}

type PaymentStepState = "pending" | "active" | "done" | "error";

function PaymentStep({
  index,
  label,
  detail,
  state,
}: {
  index: number;
  label: string;
  detail: string;
  state: PaymentStepState;
}) {
  const tone: Record<PaymentStepState, string> = {
    pending: "border-white/10 bg-slate-950/60 text-slate-400",
    active: "border-cyan-400/40 bg-cyan-500/10 text-cyan-100",
    done: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
    error: "border-rose-400/30 bg-rose-500/10 text-rose-100",
  };
  const badge: Record<PaymentStepState, string> = {
    pending: "border-white/15 text-slate-400",
    active: "border-cyan-400/40 bg-cyan-400/15 text-cyan-200 animate-pulse",
    done: "border-emerald-400/40 bg-emerald-400/15 text-emerald-200",
    error: "border-rose-400/40 bg-rose-400/15 text-rose-200",
  };
  const marker = state === "done" ? "✓" : state === "error" ? "!" : String(index);

  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${tone[state]}`}>
      <span
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold ${badge[state]}`}
        aria-hidden="true"
      >
        {marker}
      </span>
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.08em]">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-4 opacity-80">{detail}</span>
      </span>
    </div>
  );
}

export default function QueryVault({
  providerAddress,
  onProviderAddressChange,
  nearAccountId,
  walletBalanceNear,
  walletBalanceError,
  treasuryAccount,
  auditLog,
  activeTab,
  onTabChange,
  onAuditLog,
}: QueryVaultProps) {
  const walletContext = useContext(WalletContext);
  const walletAccountId = walletContext?.accountId ?? null;
  const [vaults, setVaults] = useState<MarketplaceVault[]>(DEMO_VAULTS);
  const [selectedVaultId, setSelectedVaultId] = useState<string>(DEMO_VAULTS[0].id);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<QueryStage>("idle");
  const [verifiedPayment, setVerifiedPayment] = useState<VerifiedPaymentView | null>(null);
  const [retryContext, setRetryContext] = useState<QueryExecution | null>(null);
  const [answer, setAnswer] = useState<VaultAnswer | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const [draftFiles, setDraftFiles] = useState<DraftFile[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrice, setDraftPrice] = useState("0.1");
  const [isDragging, setIsDragging] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const runIdRef = useRef(0);

  const isExecuting = stage === "signing"
    || stage === "verifying"
    || stage === "confirmed"
    || stage === "inferring";

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  const selectedVault = vaults.find((vault) => vault.id === selectedVaultId) ?? vaults[0];
  const myVaults = vaults.filter((vault) => vault.source === "session");
  const parsedPrice = Number(draftPrice);
  const providerAddressValid = isValidNearAccountId(providerAddress);
  const canPublish = draftFiles.length > 0
    && draftTitle.trim().length > 0
    && Number.isFinite(parsedPrice)
    && parsedPrice > 0
    && providerAddressValid;

  function handleSelectVault(vaultId: string) {
    if (vaultId === selectedVaultId) return;
    runIdRef.current += 1;
    setSelectedVaultId(vaultId);
    setQuery("");
    setAnswer(null);
    setStage("idle");
    setVerifiedPayment(null);
    setRetryContext(null);
    setErrorMessage(null);
  }

  function readError(result: unknown, fallback: string): string {
    if (result && typeof result === "object" && "error" in result) {
      const message = (result as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) return message;
    }
    return fallback;
  }

  async function executeAnswer(execution: QueryExecution) {
    const runId = runIdRef.current;
    const { vault, payment } = execution;

    setStage("inferring");
    setErrorMessage(null);

    const payload: Record<string, unknown> = {
      query: execution.submittedQuery,
      txHash: payment.txHash,
      payerAccountId: execution.payerAccountId,
      queryPrice: vault.priceNear,
    };
    // Sample vaults are resolved from the server-side catalog. The browser
    // only sends the vault ID, never the sample rows. Session-published vaults
    // send the dataset that this browser created.
    if (vault.source === "sample") {
      payload.vaultId = vault.id;
    } else {
      payload.dataset = vault.dataset ?? "";
    }

    const response = await fetch("/api/query-tee", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new Error("The query service returned an invalid response.");
    }

    if (runId !== runIdRef.current) return;

    if (!response.ok) {
      throw new Error(readError(result, "The query could not be completed."));
    }
    if (
      typeof result !== "object"
      || result === null
      || !("insight" in result)
      || typeof result.insight !== "string"
    ) {
      throw new Error("The query service returned an incomplete answer.");
    }

    const record = result as Record<string, unknown>;
    const acknowledgedReceiptId =
      typeof record.receiptId === "string" ? record.receiptId : undefined;
    if (acknowledgedReceiptId && acknowledgedReceiptId !== payment.txHash) {
      throw new Error("The answer was not linked to the verified payment transaction.");
    }

    const inference = typeof record.inference === "object" && record.inference !== null
      ? record.inference as Record<string, unknown>
      : {};
    const attestation = typeof record.attestation === "object" && record.attestation !== null
      ? record.attestation as Record<string, unknown>
      : {};

    const answerValue: VaultAnswer = {
      vaultTitle: vault.title,
      priceNear: vault.priceNear,
      insight: record.insight as string,
      attestationToken: typeof attestation.token === "string"
        ? attestation.token
        : `simulated-tee-${payment.txHash.slice(0, 24)}`,
      attestationSimulated: attestation.simulated !== false,
      onChainTransactionHash: payment.txHash,
      amountNear: payment.amountNear || vault.priceNear,
      receiverId: payment.receiverId || treasuryAccount,
      blockHeight: payment.blockHeight,
      model: typeof inference.model === "string" ? inference.model : "NEAR AI Cloud",
      inferenceProvider: typeof inference.provider === "string"
        ? inference.provider
        : "NEAR AI Cloud",
    };

    if (runId !== runIdRef.current) return;

    setAnswer(answerValue);
    setStage("ready");
    setRetryContext(null);
    onAuditLog(`Answer delivered for "${vault.title}"`, payment.txHash);
    setNotification(
      `Payment confirmed on NEAR testnet · ${payment.txHash.slice(0, 14)}…`,
    );
  }

  async function handleRunQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuery = query.trim();
    if (!submittedQuery || isExecuting) return;

    const vault = selectedVault;
    const wallet = walletContext?.wallet;

    if (!walletAccountId || !walletContext || !wallet) {
      setNotification("Connect a NEAR testnet wallet to sign the on-chain query payment.");
      try {
        await walletContext?.signIn();
      } catch (error) {
        setNotification(
          error instanceof Error ? error.message : "Could not open the wallet modal.",
        );
      }
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    setStage("signing");
    setAnswer(null);
    setVerifiedPayment(null);
    setRetryContext(null);
    setErrorMessage(null);

    try {
      // The user approves a real native NEAR transfer to the BlindSight
      // testnet treasury. The wallet popup is opened immediately so browsers
      // treat it as part of the click.
      const transferResult = await transferNear(walletContext, treasuryAccount, vault.priceNear);
      const onChainTransactionHash = extractTransactionHash(transferResult);
      if (!onChainTransactionHash) {
        throw new Error(
          "The wallet did not return a NEAR testnet transaction hash. No query was sent.",
        );
      }

      if (runId !== runIdRef.current) return;
      setStage("verifying");
      onAuditLog(
        `NEAR testnet payment submitted · ${vault.priceNear} NEAR to ${treasuryAccount}`,
        onChainTransactionHash,
      );

      const verificationResponse = await fetch("/api/verify-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: onChainTransactionHash,
          payerAccountId: walletAccountId,
          vaultId: vault.source === "sample" ? vault.id : undefined,
          queryPrice: vault.source === "session" ? vault.priceNear : undefined,
        }),
      });

      let verification: unknown;
      try {
        verification = await verificationResponse.json();
      } catch {
        throw new Error("The payment verification service returned an invalid response.");
      }

      if (runId !== runIdRef.current) return;

      const verificationRecord = typeof verification === "object" && verification !== null
        ? verification as Record<string, unknown>
        : {};
      if (!verificationResponse.ok || verificationRecord.verified !== true) {
        throw new Error(
          readError(verification, "The NEAR testnet payment could not be verified."),
        );
      }

      const payment = toVerifiedPayment(
        verificationRecord.payment,
        onChainTransactionHash,
        walletAccountId,
      );
      setVerifiedPayment(payment);
      setStage("confirmed");

      const execution: QueryExecution = {
        vault,
        submittedQuery,
        payerAccountId: walletAccountId,
        payment,
      };
      setRetryContext(execution);
      await executeAnswer(execution);
    } catch (error) {
      if (runId === runIdRef.current) {
        const message = error instanceof Error ? error.message : "The query could not be completed.";
        setErrorMessage(message);
        setStage("error");
        setNotification(message);
      }
    }
  }

  async function handleRetryAnswer() {
    if (!retryContext || isExecuting) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    try {
      await executeAnswer(retryContext);
    } catch (error) {
      if (runId === runIdRef.current) {
        const message = error instanceof Error ? error.message : "The query could not be completed.";
        setErrorMessage(message);
        setStage("error");
        setNotification(message);
      }
    }
  }

  function handleUnpublish(vaultId: string) {
    const vault = vaults.find((entry) => entry.id === vaultId);
    if (!vault) return;

    const remaining = vaults.filter((entry) => entry.id !== vaultId);
    setVaults(remaining);
    onAuditLog(`${vault.title} withdrawn from the marketplace`);
    setNotification(`"${vault.title}" was removed. Buyers can no longer query it.`);

    if (selectedVaultId === vaultId) {
      runIdRef.current += 1;
      setSelectedVaultId(remaining[0]?.id ?? "");
      setQuery("");
      setAnswer(null);
      setStage("idle");
      setVerifiedPayment(null);
      setRetryContext(null);
      setErrorMessage(null);
    }
  }

  async function addDraftFiles(selectedFiles: FileList | File[]) {
    const accepted: DraftFile[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(selectedFiles)) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      // Only text formats are accepted: the server analyzes the real file
      // contents, so files without extractable text are rejected.
      if (!["csv", "txt", "md", "markdown"].includes(extension)) {
        rejected.push(file.name);
        continue;
      }

      let content = "";
      try {
        content = await file.text();
      } catch {
        content = "";
      }
      if (!content.trim()) {
        rejected.push(file.name);
        continue;
      }

      accepted.push({
        id: window.crypto.randomUUID(),
        name: file.name,
        size: file.size,
        content,
      });
    }

    if (accepted.length) {
      setDraftFiles((current) => [...current, ...accepted]);
      setNotification(`${accepted.length} file${accepted.length === 1 ? "" : "s"} ready to publish.`);
      setDraftNotice("");
    } else {
      setDraftNotice("");
    }

    if (rejected.length) {
      setDraftNotice(`Skipped ${rejected.join(", ")}. Only non-empty .csv, .txt, and .md files are supported.`);
    }
  }

  function handleDraftFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addDraftFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length) void addDraftFiles(event.dataTransfer.files);
  }

  function removeDraftFile(fileId: string) {
    setDraftFiles((current) => current.filter((file) => file.id !== fileId));
  }

  async function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPublish) return;

    if (!walletAccountId) {
      setNotification("Connect a NEAR wallet to publish a session vault.");
      try {
        await walletContext?.signIn();
      } catch (error) {
        setNotification(
          error instanceof Error ? error.message : "Could not open the wallet modal.",
        );
      }
      return;
    }

    const seller = providerAddress.trim();
    if (!isValidNearAccountId(seller)) {
      setNotification("Enter a valid NEAR testnet account as the payout address.");
      return;
    }

    runIdRef.current += 1;

    const title = draftTitle.trim();
    const dataset = draftFiles.map((file) => `### ${file.name}\n${file.content}`).join("\n\n");
    const newVault: MarketplaceVault = {
      id: window.crypto.randomUUID(),
      title,
      description: draftDescription.trim() || "Published from the Vault Publisher tab.",
      category: "Custom",
      seller,
      priceNear: normalizePrice(draftPrice),
      rows: estimateRows(dataset),
      updated: "published this session",
      dataset,
      source: "session",
    };

    setVaults((current) => [newVault, ...current]);
    setSelectedVaultId(newVault.id);
    setQuery("");
    setAnswer(null);
    setStage("idle");
    setVerifiedPayment(null);
    setRetryContext(null);
    setErrorMessage(null);
    onTabChange("gateway");
    onAuditLog(`${title} published to the marketplace`);
    setNotification(`"${title}" is live in this browser session.`);
    setDraftFiles([]);
    setDraftTitle("");
    setDraftDescription("");
    setDraftPrice("0.1");
    setDraftNotice("");
  }

  return (
    <>
      {activeTab === "gateway" && (
        <section
          role="tabpanel"
          id="gateway-panel"
          aria-labelledby="gateway-tab"
          className="animate-fade-up space-y-5 rounded-2xl border border-white/10 bg-slate-900/70 p-6 backdrop-blur-xl transition-all duration-300"
        >
          {selectedVault ? (
            <>
              <div className="animate-fade-up rounded-xl border border-white/10 bg-slate-950/40 p-4 shadow-[0_0_25px_rgba(56,189,248,0.08)]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-cyan-300">
                        {selectedVault.category}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-cyan-300">
                        <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse-glow" />
                        {selectedVault.source === "sample" ? "Sample vault" : "Session vault"}
                      </span>
                    </div>
                    <h3 className="mt-2 bg-gradient-to-r from-white via-cyan-100 to-purple-200 bg-clip-text text-[15px] font-semibold text-transparent animate-shimmer">
                      {selectedVault.title}
                    </h3>
                    <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-400">
                      {selectedVault.description}
                    </p>
                  </div>
                  <span className="animate-float rounded-lg border border-purple-400/25 bg-purple-500/10 px-2.5 py-1.5 font-mono text-[12px] text-purple-200">
                    {selectedVault.priceNear} <span className="text-[10px] text-purple-300/70">NEAR</span>
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-3 text-[10px] text-slate-400">
                  <span>
                    Publisher{" "}
                    <span className="font-mono text-slate-200">
                      {selectedVault.source === "sample" ? "BlindSight sample catalog" : selectedVault.seller}
                    </span>
                    <span className="ml-1 rounded border border-amber-400/25 bg-amber-500/10 px-1 py-0.5 text-[8px] uppercase tracking-[0.1em] text-amber-300">
                      {selectedVault.source === "sample" ? "sample" : "this session"}
                    </span>
                  </span>
                  <span>
                    Rows <span className="text-slate-200">{formatNumber(selectedVault.rows)}</span>
                  </span>
                  <span>
                    Snapshot <span className="text-slate-200">{selectedVault.updated}</span>
                  </span>
                  <span>
                    Wallet{" "}
                    <span className="font-mono text-slate-200">
                      {nearAccountId
                        ? `${walletBalanceNear ?? "—"} NEAR`
                        : "not connected"}
                    </span>
                  </span>
                  <span className="w-full sm:w-auto">
                    Fee recipient{" "}
                    <a
                      href={getTreasuryExplorerUrl(treasuryAccount)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-cyan-200 underline underline-offset-2 hover:text-white"
                    >
                      {treasuryAccount} ↗
                    </a>
                  </span>
                  <label className="ml-auto flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-[0.14em] text-slate-500">Switch vault</span>
                    <select
                      value={selectedVault.id}
                      onChange={(event) => handleSelectVault(event.target.value)}
                      className="max-w-[220px] rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1 text-[10px] text-slate-200 outline-none transition focus:border-cyan-400/60"
                    >
                      {vaults.map((vault) => (
                        <option key={vault.id} value={vault.id}>
                          {vault.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {walletBalanceError && nearAccountId && (
                  <p className="mt-2 text-[9px] leading-4 text-rose-300">
                    Balance RPC error: {walletBalanceError}
                  </p>
                )}
              </div>

              <div className="animate-fade-up overflow-hidden rounded-xl border border-white/10 bg-slate-950/40" style={{ animationDelay: "80ms" }}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <div className="min-w-0">
                    <h3 className="bg-gradient-to-r from-white via-cyan-100 to-purple-200 bg-clip-text text-[11px] font-semibold text-transparent animate-shimmer">Paid query console</h3>
                    <div className="mt-0.5 truncate text-[10px] text-slate-400">
                      Real NEAR testnet payment · server-side NEAR AI inference · TEE attestation simulated
                    </div>
                  </div>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-cyan-200">
                    Native NEAR · real
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.02] px-4 py-2 text-[9px] uppercase tracking-[0.1em]">
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">Real · wallet signature</span>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">Real · NEAR testnet transfer</span>
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">Real · NEAR AI inference</span>
                  <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">Simulated · TEE attestation</span>
                  <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-amber-200">Not executed · publisher payout</span>
                </div>

                <form onSubmit={handleRunQuery} className="grid gap-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="vault-query" className="text-[11px] font-medium text-white">
                      Ask the private dataset
                    </label>
                    <span className="text-[10px] text-slate-500">{query.length} / 500</span>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-slate-950/70 transition-all duration-300 focus-within:border-cyan-400/60 focus-within:shadow-[0_0_20px_rgba(56,189,248,0.15)]">
                    <textarea
                      id="vault-query"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder="What are the biggest risks in this dataset?"
                      className="min-h-[88px] w-full resize-y bg-transparent px-3 pt-3 text-[13px] leading-6 text-slate-100 outline-none placeholder:text-slate-500"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-3 py-2.5">
                      <span className="text-[10px] text-slate-500">
                        Real native NEAR transfer to the treasury, approved in your wallet
                      </span>
                      <button
                        type="submit"
                        disabled={!query.trim() || isExecuting}
                        className="flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-500 px-3 text-[11px] font-semibold text-slate-950 shadow-[0_0_25px_rgba(34,211,238,0.25)] transition-all duration-300 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                      >
                        {stage === "signing"
                          ? "Confirm in wallet..."
                          : stage === "verifying"
                            ? "Verifying payment..."
                            : stage === "confirmed"
                              ? "Payment confirmed..."
                              : stage === "inferring"
                                ? "Generating answer..."
                                : `Pay ${selectedVault.priceNear} NEAR & ask`}
                        <span aria-hidden="true">{isExecuting ? "···" : "→"}</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {QUERY_SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setQuery(suggestion)}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-slate-400 transition-all duration-300 hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-100"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </form>

                {(stage === "signing" || stage === "verifying" || stage === "confirmed" || stage === "inferring" || stage === "ready" || stage === "error") && (
                  <div role="status" className="border-t border-white/10 bg-cyan-500/[0.04] px-4 py-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <PaymentStep
                        index={1}
                        label="Sign NEAR payment"
                        detail="Approve the transfer in your wallet"
                        state={
                          stage === "signing"
                            ? "active"
                            : stage === "error" && !verifiedPayment
                              ? "error"
                              : "done"
                        }
                      />
                      <PaymentStep
                        index={2}
                        label="Verify on-chain"
                        detail="Server checks the finalized transfer"
                        state={
                          verifiedPayment
                            ? "done"
                            : stage === "verifying"
                              ? "active"
                              : stage === "error"
                                ? "error"
                                : "pending"
                        }
                      />
                      <PaymentStep
                        index={3}
                        label="Generate answer"
                        detail="NEAR AI runs after payment clears"
                        state={
                          stage === "ready"
                            ? "done"
                            : stage === "inferring"
                              ? "active"
                              : stage === "error" && verifiedPayment
                                ? "error"
                                : "pending"
                        }
                      />
                    </div>
                  </div>
                )}

                {verifiedPayment && (
                  <div aria-live="polite" className="border-t border-emerald-400/20 bg-emerald-500/[0.05] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-200">
                        <span aria-hidden="true">✓</span>
                        Payment confirmed on NEAR testnet
                      </div>
                      <a
                        href={verifiedPayment.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-emerald-200 underline underline-offset-2 hover:text-white"
                      >
                        View transaction ↗
                      </a>
                    </div>
                    <div className="mt-1 grid gap-1 text-[10px] text-slate-400 sm:grid-cols-3">
                      <span>
                        Amount{" "}
                        <span className="font-mono text-slate-200">{verifiedPayment.amountNear || selectedVault.priceNear} NEAR</span>
                      </span>
                      <span>
                        To{" "}
                        <span className="break-all font-mono text-slate-200">{verifiedPayment.receiverId || treasuryAccount}</span>
                      </span>
                      <span>
                        Block{" "}
                        <span className="font-mono text-slate-200">{verifiedPayment.blockHeight ?? "finalized"}</span>
                      </span>
                    </div>
                    <div className="mt-1 break-all font-mono text-[9px] text-slate-500">
                      {verifiedPayment.txHash}
                    </div>
                  </div>
                )}

                {errorMessage && (
                  <div role="alert" className="border-t border-rose-400/20 bg-rose-500/[0.06] px-4 py-3">
                    <p className="text-[11px] font-semibold text-rose-200">Query failed</p>
                    <p className="mt-1 text-[10px] leading-5 text-rose-100/80">{errorMessage}</p>
                    {retryContext && (
                      <button
                        type="button"
                        onClick={() => void handleRetryAnswer()}
                        disabled={isExecuting}
                        className="mt-2 rounded-lg border border-rose-300/40 bg-rose-500/10 px-3 py-1.5 text-[10px] font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        Retry the answer with this confirmed payment
                      </button>
                    )}
                  </div>
                )}

                {answer && (
                  <div aria-live="polite" className="border-t border-white/10 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-cyan-200">
                        <span aria-hidden="true">⌑</span>
                        Answer ready
                      </div>
                      <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-emerald-200">
                        Paid · verified on-chain
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">
                      {answer.vaultTitle} · {answer.priceNear} NEAR per query · {answer.inferenceProvider} · native NEAR payment
                    </div>
                    <p className="mt-3 whitespace-pre-line break-words text-[12px] leading-6 text-slate-100">
                      {answer.insight}
                    </p>
                    <div className="mt-4 grid gap-2 text-[10px] sm:grid-cols-3">
                      <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/[0.04] px-3 py-2">
                        <span className="block text-slate-400">Verified payment</span>
                        <span className="mt-1 block font-mono text-emerald-200">
                          {answer.amountNear} NEAR · block {answer.blockHeight ?? "final"}
                        </span>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                        <span className="block text-slate-400">Inference model</span>
                        <span className="mt-1 block break-all font-mono text-slate-100">{answer.model}</span>
                      </div>
                      <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.04] px-3 py-2">
                        <span className="block text-slate-400">Enclave attestation</span>
                        <span className="mt-1 block font-mono text-amber-200">
                          {answer.attestationSimulated ? "Simulated" : "Reported by server"}
                        </span>
                        <span className="mt-1 block text-[9px] leading-4 text-slate-500">
                          Dataset discarded after inference
                        </span>
                      </div>
                      <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.04] px-3 py-2 sm:col-span-3">
                        <span className="block text-slate-400">NEAR testnet payment transaction</span>
                        <a
                          href={getTransactionExplorerUrl(answer.onChainTransactionHash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 block break-all font-mono text-[10px] text-cyan-200 underline underline-offset-2 hover:text-white"
                        >
                          {answer.onChainTransactionHash} ↗
                        </a>
                      </div>
                      <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.04] px-3 py-2 sm:col-span-3">
                        <span className="block text-slate-400">Simulated attestation token</span>
                        <code className="mt-1 block break-all font-mono text-[10px] text-amber-200">
                          {answer.attestationToken}
                        </code>
                        <span className="mt-1 block text-[9px] text-slate-500">
                          Derived from the payment hash and answer. This is not hardware attestation.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {!isExecuting && !answer && !errorMessage && (
                  <div className="border-t border-white/10 px-4 py-4 text-[11px] leading-5 text-slate-500">
                    Answers appear here only after a real NEAR testnet transfer is signed and verified.
                    The sample datasets never leave the server.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-10 text-center">
              <p className="text-[12px] text-slate-300">No vaults are live right now.</p>
              <p className="mt-1 text-[11px] text-slate-500">Publish a dataset to create the first vault.</p>
            </div>
          )}
        </section>
      )}

      {activeTab === "publish" && (
        <section
          role="tabpanel"
          id="publish-panel"
          aria-labelledby="publish-tab"
          className="animate-fade-up space-y-5 rounded-2xl border border-white/10 bg-slate-900/70 p-6 backdrop-blur-xl transition-all duration-300"
        >
          <div>
            <h3 className="bg-gradient-to-r from-white via-cyan-100 to-purple-200 bg-clip-text text-[12px] font-semibold text-transparent animate-shimmer">Publish a vault</h3>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              Package text data, set a NEAR price, and list it in this browser session. The dataset is
              sent to the server-side inference endpoint only when a paid query runs. Publishing
              itself does not submit an on-chain transaction.
            </p>
          </div>

          {draftNotice && (
            <div role="status" className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {draftNotice}
            </div>
          )}

          <div className="animate-fade-up overflow-hidden rounded-xl border border-white/10 bg-slate-950/40" style={{ animationDelay: "60ms" }}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
              <h4 className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
                My published vaults
              </h4>
              <span className="rounded-md border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200">
                {myVaults.length}
              </span>
            </div>

            {myVaults.length === 0 ? (
              <p className="px-3 py-4 text-[11px] leading-5 text-slate-500">
                You have no live vaults. Publish below to list a dataset for this browser session.
              </p>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {myVaults.map((vault) => (
                  <li key={vault.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-white">{vault.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                        <span className="font-mono text-cyan-200">{vault.priceNear} NEAR / query</span>
                        <span>{vault.rows.toLocaleString("en-US")} rows</span>
                        <span className="font-mono">{vault.seller}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnpublish(vault.id)}
                      className="w-full shrink-0 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-rose-200 transition-all duration-300 hover:border-rose-300/60 hover:bg-rose-500/20 sm:w-auto"
                      aria-label={`Unpublish vault ${vault.title}`}
                    >
                      Unpublish / Remove Vault
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handlePublish} className="grid animate-fade-up gap-4" style={{ animationDelay: "120ms" }}>
            <div>
              <span className="mb-2 block text-[11px] text-slate-400">Dataset files</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.txt,.md,.markdown"
                className="sr-only"
                onChange={handleDraftFileChange}
                aria-label="Select a CSV or text dataset (.txt, .md)"
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
                }}
                onDrop={handleDrop}
                className={`group flex min-h-[150px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 text-center transition-all duration-300 ease-in-out ${
                  isDragging
                    ? "scale-[1.01] border-cyan-400 bg-cyan-500/10 shadow-[0_0_35px_rgba(56,189,248,0.25)]"
                    : "border-white/15 bg-slate-950/40 hover:border-cyan-400/50 hover:bg-cyan-500/[0.04] hover:shadow-[0_0_25px_rgba(56,189,248,0.12)]"
                }`}
              >
                <span className="grid size-10 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-xl text-cyan-300 transition-all duration-300 group-hover:border-cyan-300/60 group-hover:shadow-[0_0_20px_rgba(56,189,248,0.2)]">
                  +
                </span>
                <span className="mt-3 text-[12px] font-medium text-white">Drop .csv, .txt, or .md files</span>
                <span className="mt-1 text-[11px] text-slate-400">
                  or <span className="text-cyan-300 underline underline-offset-2">browse your device</span>
                </span>
                <span className="mt-3 text-[10px] text-slate-500">Text is read in your browser before publishing</span>
              </div>
            </div>

            {draftFiles.length > 0 && (
              <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-slate-950/40 px-3">
                {draftFiles.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-cyan-400/25 bg-cyan-500/10 text-[9px] text-cyan-200">
                        {fileExtension(file.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] text-slate-100">{file.name}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">{formatBytes(file.size)} · ready</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDraftFile(file.id)}
                      className="shrink-0 px-2 py-1 text-[10px] text-slate-400 transition hover:text-rose-300"
                      aria-label={`Remove ${file.name}`}
                    >
                      REMOVE
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
              <label className="min-w-0">
                <span className="mb-1.5 block text-[11px] text-slate-400">Dataset title</span>
                <input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  maxLength={80}
                  placeholder="Q4 Revenue & Retention"
                  className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 text-[12px] text-slate-100 outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-cyan-400/60 focus:shadow-[0_0_20px_rgba(56,189,248,0.12)]"
                />
                <span className="mt-1 block text-[9px] text-slate-500">{draftTitle.length} / 80</span>
              </label>
              <label>
                <span className="mb-1.5 block text-[11px] text-slate-400">Price per query</span>
                <span className="relative block">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={draftPrice}
                    onChange={(event) => setDraftPrice(event.target.value)}
                    className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 pr-12 text-[12px] text-slate-100 outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-cyan-400/60 focus:shadow-[0_0_20px_rgba(56,189,248,0.12)]"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500">
                    NEAR
                  </span>
                </span>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-slate-400">Description</span>
                <textarea
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  rows={2}
                  maxLength={220}
                  placeholder="What can buyers learn from this vault?"
                  className="w-full resize-y rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-[12px] leading-5 text-slate-100 outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-cyan-400/60 focus:shadow-[0_0_20px_rgba(56,189,248,0.12)]"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[11px] text-slate-400">Payout address</span>
                <input
                  value={providerAddress}
                  onChange={(event) => onProviderAddressChange(event.target.value)}
                  maxLength={64}
                  placeholder={walletAccountId ?? "your-account.testnet"}
                  className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 font-mono text-[12px] text-slate-100 outline-none transition-all duration-300 placeholder:text-slate-500 focus:border-cyan-400/60 focus:shadow-[0_0_20px_rgba(56,189,248,0.12)]"
                />
                <span className={`mt-1 block text-[9px] ${providerAddress && !providerAddressValid ? "text-rose-300" : "text-slate-500"}`}>
                  {providerAddress && !providerAddressValid
                    ? "Not a valid NEAR account ID."
                    : "Used as the publisher identity. Payout execution is not implemented in this prototype."}
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={!canPublish}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-500 text-[12px] font-semibold text-slate-950 shadow-[0_0_25px_rgba(34,211,238,0.25)] transition-all duration-300 hover:brightness-110 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:bg-none disabled:text-slate-500 disabled:shadow-none"
            >
              {walletAccountId ? "Publish to marketplace session" : "Connect wallet to publish"}
              <span aria-hidden="true">→</span>
            </button>
            <p className="text-center text-[10px] leading-4 text-slate-500">
              Sample listings settle query fees to the real BlindSight treasury. Publisher payouts are
              not executed in this prototype.
            </p>
          </form>
        </section>
      )}

      {activeTab === "explorer" && (
        <section
          role="tabpanel"
          id="explorer-panel"
          aria-labelledby="explorer-tab"
          className="animate-fade-up space-y-5 rounded-2xl border border-white/10 bg-slate-900/70 p-6 backdrop-blur-xl transition-all duration-300"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="bg-gradient-to-r from-white via-cyan-100 to-purple-200 bg-clip-text text-[12px] font-semibold text-transparent animate-shimmer">Active vaults</h3>
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                Select a vault to open it in the Query Gateway. No file upload required.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[10px] text-cyan-200">
              <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse-glow" />
              {vaults.length} vaults online
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {vaults.map((vault, index) => {
              const isSelected = vault.id === selectedVault?.id;
              return (
                <button
                  key={vault.id}
                  type="button"
                  onClick={() => {
                    handleSelectVault(vault.id);
                    onTabChange("gateway");
                  }}
                  aria-pressed={isSelected}
                  style={{ animationDelay: `${index * 60}ms` }}
                  className={`group relative flex h-full flex-col rounded-xl border p-4 text-left transition-all duration-300 ease-in-out animate-fade-up ${
                    isSelected
                      ? "border-cyan-400/50 bg-gradient-to-br from-cyan-500/10 to-purple-500/10 shadow-[0_0_25px_rgba(56,189,248,0.15)]"
                      : "border-white/10 bg-slate-950/40 hover:border-cyan-400/40 hover:bg-white/[0.04] hover:shadow-[0_0_20px_rgba(56,189,248,0.1)]"
                  }`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-slate-300">
                      {vault.category}
                    </span>
                    {isSelected ? (
                      <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-cyan-200">
                        <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse-glow" />
                        Selected
                      </span>
                    ) : (
                      <span className="text-[12px] text-slate-500 transition group-hover:text-cyan-300" aria-hidden="true">
                        →
                      </span>
                    )}
                  </span>

                  <span className="mt-3 block text-[13px] font-medium text-white">{vault.title}</span>
                  <span className="mt-2 line-clamp-2 block text-[11px] leading-5 text-slate-400">
                    {vault.description}
                  </span>

                  <span className="mt-auto flex items-end justify-between gap-3 pt-4">
                    <span>
                      <span className="block text-[9px] uppercase tracking-[0.14em] text-slate-500">Price</span>
                      <span className="mt-1 block bg-gradient-to-r from-cyan-200 via-white to-purple-200 bg-clip-text font-mono text-[13px] text-transparent animate-shimmer">
                        {vault.priceNear} <span className="text-[10px] font-normal text-slate-400">NEAR</span>
                      </span>
                    </span>
                    <span className="text-right text-[10px] text-slate-500">
                      <span className="block text-cyan-200">
                        {vault.source === "sample" ? "Sample dataset" : "Session dataset"}
                      </span>
                      <span className="mt-0.5 block">{formatNumber(vault.rows)} rows · {vault.updated}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "audit" && (
        <section
          role="tabpanel"
          id="audit-panel"
          aria-labelledby="audit-tab"
          className="animate-fade-up space-y-5 rounded-2xl border border-white/10 bg-slate-900/70 p-6 backdrop-blur-xl transition-all duration-300"
        >
          <div>
            <h3 className="bg-gradient-to-r from-white via-cyan-100 to-purple-200 bg-clip-text text-[12px] font-semibold text-transparent animate-shimmer">Payment audit</h3>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              Real NEAR testnet settlement state and client-side activity.
            </p>
          </div>
          <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
            <PaymentAudit
              nearAccountId={nearAccountId}
              treasuryAccount={treasuryAccount}
              auditLog={auditLog}
            />
          </div>
        </section>
      )}

      {notification && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 max-w-[min(460px,calc(100vw-40px))] rounded-xl border border-cyan-400/25 bg-slate-950/95 px-4 py-3 text-xs leading-5 text-cyan-100 shadow-2xl shadow-cyan-500/10 backdrop-blur-xl"
        >
          {notification}
        </div>
      )}
    </>
  );
}
