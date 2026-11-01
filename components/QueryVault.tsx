"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  ACCOUNTS_LEDGER_EVENT,
  INITIAL_TEST_BALANCE_NEAR,
  WALLET_DEPOSIT_EVENT,
  WALLET_SYNC_EVENT,
  formatNearAmount,
  loadAccountsLedger,
  normalizeAccountAddress,
  roundNear,
  saveAccountsLedger,
  seedAccountEarnings,
  type AccountsLedger,
  type QuerySettlementResult,
  type WalletLedger,
} from "@/lib/embeddedWallet";
import WalletSummary from "@/components/WalletSummary";

type QueryVaultProps = {
  providerAddress: string;
  onProviderAddressChange: (address: string) => void;
  walletLedger: WalletLedger | null;
  onSettleQuery: (priceNear: number, vaultTitle: string, publisherAddress: string) => QuerySettlementResult;
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
};

type ViewTab = "explorer" | "publisher";

type MarketplaceVault = {
  id: string;
  title: string;
  description: string;
  category: string;
  seller: string;
  priceNear: string;
  rows: number;
  updated: string;
  dataset: string;
  earningsNear: number;
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
};

type AuditLogEntry = {
  id: string;
  message: string;
  timestamp: string;
};

const INITIAL_VAULTS: MarketplaceVault[] = [
  {
    id: "q3-financial-market-demand",
    title: "Q3 Financial & Market Demand",
    description: "Audited revenue, retention, and demand signals from a private SaaS operator.",
    category: "Finance",
    seller: "northstar.near",
    priceNear: "0.1",
    rows: 18420,
    updated: "2h ago",
    earningsNear: 184.6,
    dataset: `Q3 Financial & Market Demand
Total revenue: $4.2M, up 34% year over year.
Net revenue retention: 118% across enterprise accounts.
TEE query volume: 1.42M queries processed in Q3.
Active vault monetizers: 850 enterprise accounts.
Projected 2026 revenue: $22.6M at the current growth rate.
Top demand signal: confidential analytics for regulated financial datasets.
Gross margin: 81% after inference and settlement costs.
Churn: 2.1% monthly, concentrated in self-serve accounts.
Largest risk: inference cost volatility during peak demand.`,
  },
  {
    id: "medical-research-cohort-2026",
    title: "Medical Research Cohort 2026",
    description: "De-identified cohort outcomes and biomarker signals from a 2026 multi-site study.",
    category: "Health",
    seller: "cohortlab.near",
    priceNear: "0.15",
    rows: 12480,
    updated: "5h ago",
    earningsNear: 96.25,
    dataset: `Medical Research Cohort 2026
De-identified participants: 12,480 across 14 sites.
Primary endpoint: 23% reduction in biomarker variance.
Adverse event rate: 1.8%, with no severe events reported.
Median follow-up: 18 months.
Strongest cohort signal: responders show elevated IL-6 at baseline.
Data retention: all records remain inside the enclave.
Largest risk: missing longitudinal samples for 6% of participants.
Projected enrollment for 2027: 18,000 participants.`,
  },
  {
    id: "solidity-security-audit-report",
    title: "Solidity Security Audit Report",
    description: "Findings, coverage, and risk posture for a production DeFi protocol audit.",
    category: "Security",
    seller: "auditdao.near",
    priceNear: "0.08",
    rows: 342,
    updated: "1d ago",
    earningsNear: 42.18,
    dataset: `Solidity Security Audit Report
Contracts reviewed: 9 core contracts and 3 upgradeable proxies.
Critical findings: 0 open, 2 resolved.
High findings: 1 open, 5 resolved.
Reentrancy: guarded with checks-effects-interactions and a mutex.
Access control: 2 admin roles, both behind a 48-hour timelock.
Oracle risk: single-source price feed flagged for hardening.
Test coverage: 94% branch coverage across critical paths.
Largest risk: privileged upgrade path requires operational discipline.`,
  },
  {
    id: "defi-liquidity-insights",
    title: "DeFi Liquidity Insights",
    description: "Live-style liquidity, volume, and yield signals across six managed pools.",
    category: "DeFi",
    seller: "liquidity.near",
    priceNear: "0.12",
    rows: 9640,
    updated: "3h ago",
    earningsNear: 128.9,
    dataset: `DeFi Liquidity Insights
Total value locked: $186M across 6 pools.
Stablecoin pool depth: $74M with 0.04% median slippage on $1M swaps.
30-day volume: $1.9B, up 41% month over month.
Liquidity utilization: 68% average across active pools.
Top yield opportunity: ETH/USDC pool at 9.2% APY.
Impermanent loss: 1.4% average for the past 30 days.
Largest risk: concentrated LP ownership in the newest pool.
Projected TVL for Q1 2027: $240M at current inflow.`,
  },
];

const QUERY_SUGGESTIONS = [
  "Summarize the headline metrics",
  "What are the biggest risks?",
  "Show the strongest growth signal",
];

const STOP_WORDS = new Set([
  "about", "above", "after", "again", "against", "also", "among", "and", "are", "because",
  "been", "before", "being", "between", "both", "but", "can", "could", "data", "dataset",
  "did", "does", "doing", "each", "for", "from", "give", "had", "has", "have", "here",
  "how", "into", "its", "just", "main", "more", "most", "not", "now", "off", "once",
  "only", "other", "our", "out", "over", "please", "query", "same", "she", "should",
  "show", "some", "such", "tell", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "through", "under", "until", "very",
  "vault", "was", "were", "what", "when", "where", "which", "while", "who", "why",
  "will", "with", "would", "you", "your",
]);

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

function createAttestationToken() {
  const bytes = new Uint8Array(8);
  window.crypto.getRandomValues(bytes);
  return `mock_tee_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function estimateRows(dataset: string) {
  const records = dataset.split("\n").filter((line) => line.trim().length > 0).length;
  return Math.max(1, Math.round(records * 1.4));
}

function buildVaultInsight(vault: MarketplaceVault, query: string) {
  const terms = Array.from(new Set(
    query.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((term) => !STOP_WORDS.has(term)) ?? [],
  ));
  const lines = vault.dataset
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 2);

  const ranked = lines
    .map((line) => {
      const lower = line.toLowerCase();
      const score = terms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
      return { line, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => entry.line);

  const numericFallback = lines.filter((line) => /\d/.test(line)).slice(0, 3);
  const evidence = ranked.length ? ranked : numericFallback.length ? numericFallback : lines.slice(0, 3);
  const bullets = evidence.map((line) => `- ${line}`).join("\n");

  return [
    `Simulated TEE analysis for "${vault.title}"`,
    `Question: "${query}"`,
    "",
    bullets,
    "",
    `This answer was assembled in your browser from the vault's published sample of ${formatNumber(vault.rows)} rows. No network request or real hardware attestation was performed.`,
  ].join("\n");
}

export default function QueryVault({
  providerAddress,
  onProviderAddressChange,
  walletLedger,
  onSettleQuery,
  onOpenDeposit,
  onOpenWithdraw,
}: QueryVaultProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>("explorer");
  const [vaults, setVaults] = useState<MarketplaceVault[]>(INITIAL_VAULTS);
  const [selectedVaultId, setSelectedVaultId] = useState<string>(INITIAL_VAULTS[0].id);
  const [query, setQuery] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [answer, setAnswer] = useState<VaultAnswer | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [accountsLedger, setAccountsLedger] = useState<AccountsLedger>({});
  const [notification, setNotification] = useState<string | null>(null);

  const [draftFiles, setDraftFiles] = useState<DraftFile[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPrice, setDraftPrice] = useState("0.1");
  const [isDragging, setIsDragging] = useState(false);
  const [draftNotice, setDraftNotice] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timeoutRef = useRef<number | null>(null);
  const runIdRef = useRef(0);

  const showNotification = useCallback((message: string) => {
    setNotification(message);
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    const accounts = loadAccountsLedger();
    let changed = false;
    for (const vault of INITIAL_VAULTS) {
      const seeded = seedAccountEarnings(accounts, vault.seller, vault.earningsNear);
      if (seeded.changed) changed = true;
    }
    if (changed) saveAccountsLedger(accounts);
    const timer = window.setTimeout(() => setAccountsLedger(accounts), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!walletLedger) return;
    const key = normalizeAccountAddress(walletLedger.accountId);
    const timer = window.setTimeout(() => {
      setAccountsLedger((current) => ({ ...current, [key]: walletLedger }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [walletLedger]);

  useEffect(() => {
    const refreshAccounts = () => setAccountsLedger(loadAccountsLedger());
    window.addEventListener(ACCOUNTS_LEDGER_EVENT, refreshAccounts);
    return () => window.removeEventListener(ACCOUNTS_LEDGER_EVENT, refreshAccounts);
  }, []);

  useEffect(() => {
    const handleWalletSync = (event: Event) => {
      const walletsDb = loadAccountsLedger();
      setAccountsLedger(walletsDb);

      const detail = (event as CustomEvent<{ fromAddr?: string; toAddr?: string }>).detail;
      if (!detail?.toAddr) {
        showNotification("Transfer complete.");
        return;
      }

      const recipient = walletsDb[normalizeAccountAddress(detail.toAddr)];
      const credit = recipient?.transactions.find((transaction) => transaction.type === "DEPOSIT_CREDIT");
      showNotification(
        credit
          ? `Transfer complete · ${credit.amount} received by ${detail.toAddr}`
          : `Transfer complete · ${detail.toAddr} credited.`,
      );
    };

    const handleDeposit = (event: Event) => {
      const detail = (event as CustomEvent<{ amount?: number }>).detail;
      showNotification(
        typeof detail?.amount === "number"
          ? `Deposit complete · ${formatNearAmount(detail.amount)} added to your wallet.`
          : "Deposit complete.",
      );
    };

    window.addEventListener(WALLET_SYNC_EVENT, handleWalletSync);
    window.addEventListener(WALLET_DEPOSIT_EVENT, handleDeposit);
    return () => {
      window.removeEventListener(WALLET_SYNC_EVENT, handleWalletSync);
      window.removeEventListener(WALLET_DEPOSIT_EVENT, handleDeposit);
    };
  }, [showNotification]);

  const selectedVault = vaults.find((vault) => vault.id === selectedVaultId) ?? vaults[0];
  const publisherKey = (providerAddress.trim() || "you.near").toLowerCase();
  const myVaults = vaults.filter((vault) => vault.seller.trim().toLowerCase() === publisherKey);
  const parsedPrice = Number(draftPrice);
  const canPublish = draftFiles.length > 0
    && draftTitle.trim().length > 0
    && Number.isFinite(parsedPrice)
    && parsedPrice > 0;

  function publisherEarnings(address: string): number {
    const account = accountsLedger[normalizeAccountAddress(address)];
    if (!account) return 0;
    return Math.max(0, roundNear(account.balanceNear - INITIAL_TEST_BALANCE_NEAR));
  }

  function handleSelectVault(vaultId: string) {
    if (vaultId === selectedVaultId) return;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    runIdRef.current += 1;
    setSelectedVaultId(vaultId);
    setQuery("");
    setAnswer(null);
    setIsExecuting(false);
  }

  function handleRunQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuery = query.trim();
    if (!submittedQuery || isExecuting) return;

    const vault = selectedVault;
    const priceNear = Number(vault.priceNear);
    const settlement = onSettleQuery(priceNear, vault.title, vault.seller);
    if (!settlement.success) {
      showNotification(settlement.message ?? "The query could not be settled. Check your wallet balance.");
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setIsExecuting(true);
    setAnswer(null);

    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      if (runId !== runIdRef.current) return;
      setAnswer({
        vaultTitle: vault.title,
        priceNear: vault.priceNear,
        insight: buildVaultInsight(vault, submittedQuery),
        attestationToken: createAttestationToken(),
      });
      setIsExecuting(false);
      timeoutRef.current = null;
    }, 480);
  }

  function handleUnpublish(vaultId: string) {
    const vault = vaults.find((entry) => entry.id === vaultId);
    if (!vault) return;

    const remaining = vaults.filter((entry) => entry.id !== vaultId);
    setVaults(remaining);
    setAuditLog((current) => [
      {
        id: window.crypto.randomUUID(),
        message: `${vault.title} withdrawn from enclave marketplace`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      },
      ...current,
    ]);
    showNotification(`"${vault.title}" was removed. Buyers can no longer query it.`);

    if (selectedVaultId === vaultId) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      runIdRef.current += 1;
      setSelectedVaultId(remaining[0]?.id ?? "");
      setQuery("");
      setAnswer(null);
      setIsExecuting(false);
    }
  }

  async function addDraftFiles(selectedFiles: FileList | File[]) {
    const accepted: DraftFile[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(selectedFiles)) {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!["pdf", "csv", "txt"].includes(extension)) {
        rejected.push(file.name);
        continue;
      }

      let content = "";
      if (extension === "pdf") {
        content = `PDF document "${file.name}" (${formatBytes(file.size)}). Local text extraction is simulated in this demo.`;
      } else {
        try {
          content = await file.text();
        } catch {
          content = "";
        }
        if (!content.trim()) {
          content = `Document "${file.name}" (${formatBytes(file.size)}).`;
        }
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
      showNotification(`${accepted.length} file${accepted.length === 1 ? "" : "s"} ready to publish.`);
      setDraftNotice("");
    } else {
      setDraftNotice("");
    }

    if (rejected.length) {
      setDraftNotice(`Skipped ${rejected.join(", ")}. Only .pdf, .csv, and .txt files are supported.`);
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

  function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canPublish) return;

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    runIdRef.current += 1;

    const title = draftTitle.trim();
    const dataset = draftFiles.map((file) => `### ${file.name}\n${file.content}`).join("\n\n");
    const newVault: MarketplaceVault = {
      id: window.crypto.randomUUID(),
      title,
      description: draftDescription.trim() || "Published from the Vault Publisher tab.",
      category: "Custom",
      seller: providerAddress.trim() || "you.near",
      priceNear: normalizePrice(draftPrice),
      rows: estimateRows(dataset),
      updated: "just now",
      dataset,
      earningsNear: 0,
    };

    setVaults((current) => [newVault, ...current]);
    setSelectedVaultId(newVault.id);
    setQuery("");
    setAnswer(null);
    setIsExecuting(false);
    setActiveTab("explorer");
    showNotification(`"${title}" is live in the local TEE marketplace.`);
    setDraftFiles([]);
    setDraftTitle("");
    setDraftDescription("");
    setDraftPrice("0.1");
    setDraftNotice("");
  }

  return (
    <>
    <section className="flex min-w-0 flex-col overflow-hidden border border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl transition-colors hover:border-emerald-500/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/20 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="size-2 rotate-45 border border-[#34D399]" />
          <div>
            <h2 className="text-[14px] font-medium text-[#F0FDF4]">Query Vault</h2>
            <p className="mt-0.5 text-[10px] text-[#7D9187]">Private datasets, attested answers</p>
          </div>
        </div>
        <span className="flex items-center gap-2 text-[10px] text-[#A7B9B0]">
          <span className="size-1.5 rounded-full bg-[#34D399]" />
          TEE marketplace · demo
        </span>
      </div>

      <div className="border-b border-emerald-500/20 px-4 py-3 sm:px-5">
        <div
          role="tablist"
          aria-label="Vault views"
          className="flex w-full gap-1 border border-emerald-500/20 bg-[#0B0F17]/60 p-1 sm:w-fit"
        >
          <button
            id="explorer-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === "explorer"}
            aria-controls="explorer-panel"
            onClick={() => setActiveTab("explorer")}
            className={`flex-1 px-4 py-2 text-[11px] font-medium transition sm:flex-none ${
              activeTab === "explorer"
                ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                : "text-[#A7B9B0] hover:bg-emerald-950/40 hover:text-[#F0FDF4]"
            }`}
          >
            Data Explorer
          </button>
          <button
            id="publisher-tab"
            type="button"
            role="tab"
            aria-selected={activeTab === "publisher"}
            aria-controls="publisher-panel"
            onClick={() => setActiveTab("publisher")}
            className={`flex-1 px-4 py-2 text-[11px] font-medium transition sm:flex-none ${
              activeTab === "publisher"
                ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"
                : "text-[#A7B9B0] hover:bg-emerald-950/40 hover:text-[#F0FDF4]"
            }`}
          >
            Vault Publisher
          </button>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-5">
        {activeTab === "explorer" ? (
          <div
            role="tabpanel"
            id="explorer-panel"
            aria-labelledby="explorer-tab"
            className="space-y-4"
          >
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-[12px] font-medium text-[#E2F8EC]">Active Enclave Vaults</h3>
                <p className="mt-1 text-[11px] leading-5 text-[#A7B9B0]">
                  Select a vault to query it instantly. No file upload required.
                </p>
              </div>
              <span className="border border-emerald-500/20 bg-emerald-950/30 px-2 py-1 text-[10px] text-[#34D399]">
                {vaults.length} vaults online
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {vaults.map((vault) => {
                const isSelected = vault.id === selectedVault.id;
                return (
                  <button
                    key={vault.id}
                    type="button"
                    onClick={() => handleSelectVault(vault.id)}
                    aria-pressed={isSelected}
                    className={`group relative flex h-full flex-col border p-4 text-left transition ${
                      isSelected
                        ? "border-[#10B981]/70 bg-emerald-950/50 shadow-[0_0_0_1px_rgba(16,185,129,0.25)]"
                        : "border-emerald-500/20 bg-[#0B0F17]/60 hover:border-emerald-500/40 hover:bg-emerald-950/30"
                    }`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="border border-emerald-500/20 bg-[#0B0F17]/60 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#34D399]">
                        {vault.category}
                      </span>
                      {isSelected ? (
                        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-[#34D399]">
                          <span className="size-1.5 rounded-full bg-[#34D399]" />
                          Selected
                        </span>
                      ) : (
                        <span className="text-[12px] text-[#7D9187] transition group-hover:text-[#34D399]" aria-hidden="true">
                          →
                        </span>
                      )}
                    </span>

                    <span className="mt-3 block text-[13px] font-medium text-[#F0FDF4]">
                      {vault.title}
                    </span>
                    <span className="mt-2 line-clamp-2 block text-[11px] leading-5 text-[#A7B9B0]">
                      {vault.description}
                    </span>

                    <span className="mt-auto flex items-end justify-between gap-3 pt-4">
                      <span>
                        <span className="block text-[9px] uppercase tracking-[0.14em] text-[#7D9187]">Price</span>
                        <span className="mt-1 block font-mono text-[13px] text-[#F0FDF4]">
                          {vault.priceNear} <span className="text-[10px] font-normal text-[#A7B9B0]">NEAR</span>
                        </span>
                      </span>
                      <span className="text-right text-[10px] text-[#7D9187]">
                        <span className="block text-[#34D399]">Earned {formatNearAmount(publisherEarnings(vault.seller))}</span>
                        <span className="mt-0.5 block">{formatNumber(vault.rows)} rows · {vault.updated}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="border border-emerald-500/20 bg-[#0B0F17]/80 backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/20 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-[11px] font-medium text-[#E2F8EC]">Attested Query Console</h3>
                  <div className="mt-1 truncate text-[10px] text-[#A7B9B0]">Selected vault · {selectedVault.title}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="border border-emerald-500/20 bg-[#0B0F17]/60 px-2 py-1 font-mono text-[10px] text-[#34D399]">
                    {selectedVault.priceNear} NEAR / query
                  </span>
                  <span className="hidden border border-emerald-500/20 px-2 py-1 font-mono text-[9px] text-[#A7B9B0] sm:inline">
                    Publisher earned {formatNearAmount(publisherEarnings(selectedVault.seller))}
                  </span>
                  <span className="hidden border border-emerald-500/20 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#A7B9B0] sm:inline">
                    No upload
                  </span>
                </div>
              </div>

              <form onSubmit={handleRunQuery} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label htmlFor="vault-query" className="text-[11px] font-medium text-[#E2F8EC]">
                    Ask the private dataset
                  </label>
                  <span className="text-[10px] text-[#7D9187]">{query.length} / 500</span>
                </div>
                <div className="border border-emerald-500/20 bg-[#0B0F17]/80 transition-colors focus-within:border-[#10B981]/70">
                  <textarea
                    id="vault-query"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    rows={3}
                    maxLength={500}
                    placeholder="What is the projected revenue for 2026?"
                    className="min-h-[88px] w-full resize-y bg-transparent px-3 pt-3 text-[13px] leading-6 text-[#F0FDF4] outline-none placeholder:text-[#7D9187]"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-500/20 px-3 py-2.5">
                    <span className="text-[10px] text-[#7D9187]">Simulated TEE execution · local demo</span>
                    <button
                      type="submit"
                      disabled={!query.trim() || isExecuting}
                      className="flex h-9 items-center gap-2 bg-emerald-500 px-3 text-[11px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isExecuting ? "Processing..." : `Run query · ${selectedVault.priceNear} NEAR`}
                      <span aria-hidden="true">{isExecuting ? "···" : "→"}</span>
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUERY_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setQuery(suggestion)}
                      className="border border-emerald-500/20 bg-[#0B0F17]/60 px-2.5 py-1.5 text-[10px] text-[#A7B9B0] transition hover:border-emerald-500/40 hover:text-[#F0FDF4]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </form>

              {isExecuting && (
                <div role="status" className="border-t border-emerald-500/20 bg-emerald-950/20 px-4 py-4">
                  <div className="flex items-center gap-3 text-[12px] text-[#34D399]">
                    <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
                    Routing the query through the simulated TEE enclave...
                  </div>
                  <div className="mt-3 h-1 w-full overflow-hidden bg-emerald-500/10">
                    <div className="h-full w-1/2 animate-pulse bg-emerald-500/60" />
                  </div>
                </div>
              )}

              {!isExecuting && answer && (
                <div aria-live="polite" className="border-t border-emerald-500/20 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-[#34D399]">
                      <span aria-hidden="true">⌑</span>
                      Simulated TEE response
                    </div>
                    <span className="border border-emerald-500/20 px-2 py-1 text-[9px] uppercase tracking-[0.14em] text-[#D1FAE5]">
                      Simulated attestation
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-[#7D9187]">
                    {answer.vaultTitle} · {answer.priceNear} NEAR per query
                  </div>
                  <p className="mt-3 whitespace-pre-line break-words text-[12px] leading-6 text-[#E2F8EC]">
                    {answer.insight}
                  </p>
                  <div className="mt-4 grid gap-2 text-[10px] sm:grid-cols-3">
                    <div className="border border-emerald-500/20 bg-[#0B0F17]/60 px-3 py-2">
                      <span className="block text-[#A7B9B0]">Attestation token</span>
                      <code className="mt-1 block break-all font-mono text-[10px] text-[#34D399]">
                        {answer.attestationToken}
                      </code>
                    </div>
                    <div className="border border-emerald-500/20 bg-[#0B0F17]/60 px-3 py-2">
                      <span className="block text-[#A7B9B0]">Anti-probing</span>
                      <span className="mt-1 block font-mono text-[#F0FDF4]">PASSED</span>
                    </div>
                    <div className="border border-emerald-500/20 bg-[#0B0F17]/60 px-3 py-2">
                      <span className="block text-[#A7B9B0]">Query price</span>
                      <span className="mt-1 block font-mono text-[#F0FDF4]">{answer.priceNear} NEAR · settled locally</span>
                    </div>
                  </div>
                  <p className="mt-3 text-[10px] leading-4 text-[#7D9187]">
                    Local demo only. Balance settlement is simulated in this browser; no network call or real hardware attestation occurred.
                  </p>
                </div>
              )}

              {!isExecuting && !answer && (
                <div className="border-t border-emerald-500/20 px-4 py-4 text-[11px] leading-5 text-[#7D9187]">
                  Answers appear here after a query. Each run is simulated locally against the selected vault sample.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            role="tabpanel"
            id="publisher-panel"
            aria-labelledby="publisher-tab"
            className="space-y-4"
          >
            <WalletSummary
              ledger={walletLedger}
              onDepositClick={onOpenDeposit}
              onWithdrawClick={onOpenWithdraw}
            />

            <div>
              <h3 className="text-[12px] font-medium text-[#E2F8EC]">Publish a vault</h3>
              <p className="mt-1 text-[11px] leading-5 text-[#A7B9B0]">
                Package a dataset, set a NEAR price, and publish it to the marketplace. Files never leave this browser.
              </p>
            </div>

            {draftNotice && (
              <div role="status" className="border border-emerald-500/20 bg-emerald-950/40 px-3 py-2 text-[11px] text-[#D1FAE5]">
                {draftNotice}
              </div>
            )}

            <div className="border border-emerald-500/20 bg-[#0B0F17]/50">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 px-3 py-2.5">
                <h4 className="text-[11px] uppercase tracking-[0.14em] text-[#A7B9B0]">
                  My published vaults
                </h4>
                <span className="border border-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] text-[#34D399]">
                  {myVaults.length}
                </span>
              </div>

              {myVaults.length === 0 ? (
                <p className="px-3 py-4 text-[11px] leading-5 text-[#7D9187]">
                  You have no live vaults. Publish below to list a dataset in the enclave marketplace.
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {myVaults.map((vault) => (
                    <li key={vault.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-[#F0FDF4]">{vault.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#7D9187]">
                          <span className="font-mono text-[#34D399]">{vault.priceNear} NEAR / query</span>
                          <span>{vault.rows.toLocaleString("en-US")} rows</span>
                          <span>Earned {formatNearAmount(publisherEarnings(vault.seller))}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnpublish(vault.id)}
                        className="w-full shrink-0 border border-[#F87171]/40 bg-[#F87171]/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#FCA5A5] transition hover:border-[#F87171] hover:bg-[#F87171]/20 sm:w-auto"
                        aria-label={`Unpublish vault ${vault.title}`}
                      >
                        Unpublish / Remove Vault
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form onSubmit={handlePublish} className="space-y-4">
              <div>
                <span className="mb-2 block text-[11px] text-[#A7B9B0]">Dataset files</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.csv,.txt"
                  className="sr-only"
                  onChange={handleDraftFileChange}
                  aria-label="Select a PDF, CSV, or text dataset"
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
                  className={`group flex min-h-[150px] cursor-pointer flex-col items-center justify-center border border-dashed px-4 text-center transition-colors ${
                    isDragging
                      ? "border-[#10B981] bg-[#10B981]/[0.06]"
                      : "border-emerald-500/25 bg-[#0B0F17]/60 hover:border-[#34D399] hover:bg-emerald-950/30"
                  }`}
                >
                  <span className="grid size-10 place-items-center border border-[#34D399]/45 bg-[#34D399]/[0.06] text-xl text-[#10B981] transition group-hover:border-[#10B981]/70">
                    +
                  </span>
                  <span className="mt-3 text-[12px] font-medium text-[#F0FDF4]">Drop .pdf, .csv, or .txt files</span>
                  <span className="mt-1 text-[11px] text-[#A7B9B0]">
                    or <span className="text-[#34D399] underline underline-offset-2">browse your device</span>
                  </span>
                  <span className="mt-3 text-[10px] text-[#7D9187]">Parsed locally · no network request</span>
                </div>
              </div>

              {draftFiles.length > 0 && (
                <ul className="divide-y divide-white/[0.06] border-y border-white/[0.07]">
                  {draftFiles.map((file) => (
                    <li key={file.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center border border-emerald-500/20 text-[9px] text-[#34D399]">
                          {fileExtension(file.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] text-[#D1FAE5]">{file.name}</span>
                          <span className="mt-0.5 block text-[10px] text-[#7D9187]">{formatBytes(file.size)} · ready</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeDraftFile(file.id)}
                        className="shrink-0 px-2 py-1 text-[10px] text-[#A7B9B0] hover:text-[#FCA5A5]"
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
                  <span className="mb-1.5 block text-[11px] text-[#A7B9B0]">Dataset title</span>
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    maxLength={80}
                    placeholder="Q4 Revenue & Retention"
                    className="h-10 w-full border border-emerald-500/20 bg-[#0B0F17]/80 px-3 text-[12px] text-[#E2F8EC] outline-none transition placeholder:text-[#7D9187] focus:border-[#10B981]/60"
                  />
                  <span className="mt-1 block text-[9px] text-[#7D9187]">{draftTitle.length} / 80</span>
                </label>
                <label>
                  <span className="mb-1.5 block text-[11px] text-[#A7B9B0]">Price per query</span>
                  <span className="relative block">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={draftPrice}
                      onChange={(event) => setDraftPrice(event.target.value)}
                      className="h-10 w-full border border-emerald-500/20 bg-[#0B0F17]/80 px-3 pr-12 text-[12px] text-[#E2F8EC] outline-none transition placeholder:text-[#7D9187] focus:border-[#10B981]/60"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[#7D9187]">
                      NEAR
                    </span>
                  </span>
                </label>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[11px] text-[#A7B9B0]">Description</span>
                <textarea
                  value={draftDescription}
                  onChange={(event) => setDraftDescription(event.target.value)}
                  rows={2}
                  maxLength={220}
                  placeholder="What can buyers learn from this vault?"
                  className="w-full resize-y border border-emerald-500/20 bg-[#0B0F17]/80 px-3 py-2 text-[12px] leading-5 text-[#E2F8EC] outline-none transition placeholder:text-[#7D9187] focus:border-[#10B981]/60"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[11px] text-[#A7B9B0]">Payout address</span>
                <input
                  value={providerAddress}
                  onChange={(event) => onProviderAddressChange(event.target.value)}
                  maxLength={128}
                  placeholder="you.near"
                  className="h-10 w-full border border-emerald-500/20 bg-[#0B0F17]/80 px-3 text-[12px] text-[#E2F8EC] outline-none transition placeholder:text-[#7D9187] focus:border-[#10B981]/60"
                />
              </label>

              <button
                type="submit"
                disabled={!canPublish}
                className="flex h-11 w-full items-center justify-center gap-2 bg-emerald-500 text-[12px] font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-[#047857] disabled:text-[#A7B9B0]"
              >
                Publish to TEE Marketplace
                <span aria-hidden="true">→</span>
              </button>
              <p className="text-center text-[10px] leading-4 text-[#7D9187]">
                Publishing is local to this demo. No data or funds leave the browser.
              </p>
            </form>

            <div className="border border-emerald-500/20 bg-[#0B0F17]/50">
              <div className="border-b border-emerald-500/20 px-3 py-2.5">
                <h4 className="text-[11px] uppercase tracking-[0.14em] text-[#A7B9B0]">
                  Enclave audit log
                </h4>
              </div>
              {auditLog.length === 0 ? (
                <p className="px-3 py-4 text-[11px] leading-5 text-[#7D9187]">
                  No marketplace changes yet. Withdrawing a vault records an entry here.
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {auditLog.map((entry) => (
                    <li key={entry.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0 text-[11px] leading-5 text-[#D1FAE5]">{entry.message}</span>
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-[#7D9187]">
                        {entry.timestamp}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
    {notification && (
      <div
        role="status"
        className="fixed bottom-5 right-5 z-50 max-w-[min(460px,calc(100vw-40px))] border border-emerald-500/25 bg-emerald-950/95 px-4 py-3 text-xs leading-5 text-[#D1FAE5] shadow-2xl shadow-black/40"
      >
        {notification}
      </div>
    )}
    </>
  );
}
