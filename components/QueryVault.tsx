"use client";

import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { Buffer } from "buffer";
import { Search, Trash2, X } from "lucide-react";
import { WalletContext } from "@/components/WalletProvider";
import PrivacyReceipt, { parsePrivacyReceipt, type PrivacyReceiptData } from "@/components/PrivacyReceipt";
import { DEMO_VAULTS, type MarketplaceVault } from "@/lib/demoVaults";
import { isValidNearAccountId } from "@/lib/nearAccount";
import { buildUnpublishMessage, OWNERSHIP_NONCE_BYTES, OWNERSHIP_RECIPIENT } from "@/lib/vaultOwnership";
import { extractTransactionHash, transferNear, transferNearBatch, type NearTransferRequest } from "@/lib/near-transfers";
import { addNearAmounts, getPlatformTreasury, getPublishFeeNear, getQueryFeeNear, isFeeEnabled } from "@/lib/platformFees";
import type { WalletActivityDraft } from "@/lib/walletActivity";
import { isUserCancellation, signMessageWithWallet, type WalletSignature } from "@/lib/walletSignMessage";

type QueryVaultProps = {
  providerAddress: string;
  onProviderAddressChange: (address: string) => void;
  treasuryAccount: string;
  onQueryPayment: (activity: WalletActivityDraft) => void;
  activeTab: VaultTab;
  onTabChange: (tab: VaultTab) => void;
};

export type VaultTab = "gateway" | "publish" | "explorer";

export const VAULT_TABS: { id: VaultTab; label: string }[] = [
  { id: "gateway", label: "Ask" },
  { id: "explorer", label: "Browse" },
  { id: "publish", label: "Publish" },
];

type QueryStage = "idle" | "paying" | "answering" | "ready" | "error";

type QueryExecution = {
  vault: MarketplaceVault;
  submittedQuery: string;
  payerAccountId: string;
  txHash: string;
  /** Platform-fee transfer, when the query fee is enabled. */
  feeTxHash?: string;
};

const QUERY_FEE_NEAR = getQueryFeeNear();
const PUBLISH_FEE_NEAR = getPublishFeeNear();
const PLATFORM_TREASURY = getPlatformTreasury();

/** A user-facing query failure. `canRetry` means the payment can be reused. */
class QueryError extends Error {
  constructor(message: string, readonly canRetry: boolean) {
    super(message);
  }
}

const ANSWER_RETRY_MESSAGE = "We couldn't get your answer this time. Your question is ready to try again.";

function toQueryError(status: number, code?: string): QueryError {
  if (code === "INFERENCE_NOT_CONFIGURED") {
    return new QueryError("Inference is not configured. Your payment is confirmed; retry after the server key is configured.", true);
  }
  if (code === "INFERENCE_INVALID_API_KEY") {
    return new QueryError("NEAR AI rejected the server key. Your payment is confirmed; retry after the key is corrected.", true);
  }
  if (code === "INFERENCE_ACCESS_DENIED") {
    return new QueryError("NEAR AI denied model access. Your payment is confirmed; retry after access is corrected.", true);
  }
  if (status === 429) {
    return new QueryError("Too many similar questions. Try asking something broader.", false);
  }
  if (status === 422) {
    return new QueryError("This vault can't answer questions right now. Try another vault.", false);
  }
  if (status === 400 || status === 413) {
    return new QueryError("Your question couldn't be sent. Shorten it and try again.", false);
  }
  if (status === 409) {
    if (code === "PAYMENT_IN_PROGRESS") {
      return new QueryError("Your answer is still being prepared. Please try again shortly.", true);
    }
    return new QueryError("This question has already been answered. Ask something new.", false);
  }
  if (status === 402) {
    return new QueryError("Your question didn't go through. Please try again in a moment.", true);
  }
  return new QueryError(ANSWER_RETRY_MESSAGE, true);
}

function toPaymentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/reject|cancel|denied|closed|declin/.test(message)) return "Payment cancelled. You weren't charged.";
  if (/insufficient|not enough|balance/.test(message)) return "Not enough NEAR in your wallet for this question.";
  if (/did not return/.test(message)) return "We couldn't confirm your payment. Check your wallet activity before trying again.";
  return "The payment didn't go through. You weren't charged.";
}

type DraftFile = {
  id: string;
  name: string;
  size: number;
  content: string;
};

type VaultAnswer = {
  vaultTitle: string;
  insight: string;
  privacy?: PrivacyReceiptData | null;
};

const PANEL = "rounded-2xl border border-white/10 bg-slate-900/70 backdrop-blur-xl";
const FIELD_LABEL = "text-xs font-medium text-slate-400";
const INPUT = "min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 text-base text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/60 disabled:opacity-60 sm:text-sm";
const PRIMARY_BUTTON = "inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-400 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY_BUTTON = "inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] px-4 text-sm font-medium text-slate-100 transition hover:bg-white/[0.08]";

const QUERY_SUGGESTIONS = [
  "Summarize the headline metrics",
  "What are the biggest risks?",
  "Show the strongest growth signal",
];

function renderInlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em] text-cyan-100">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index} className="italic text-slate-200">{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function renderInsight(value: string): ReactNode {
  const blocks = value.trim().split(/\n\s*\n/).filter(Boolean);

  return blocks.map((block, blockIndex) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const heading = lines.length === 1 ? lines[0].match(/^#{1,3}\s+(.+)$/) : null;

    if (heading) {
      return <h5 key={blockIndex} className="text-base font-semibold leading-6 text-white">{renderInlineMarkdown(heading[1])}</h5>;
    }

    const unorderedItems = lines.map((line) => line.match(/^[-*]\s+(.+)$/));
    if (unorderedItems.every(Boolean)) {
      return (
        <ul key={blockIndex} className="list-disc space-y-2 pl-5 marker:text-cyan-300">
          {unorderedItems.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item![1])}</li>
          ))}
        </ul>
      );
    }

    const orderedItems = lines.map((line) => line.match(/^\d+[.)]\s+(.+)$/));
    if (orderedItems.every(Boolean)) {
      return (
        <ol key={blockIndex} className="list-decimal space-y-2 pl-5 marker:text-cyan-300">
          {orderedItems.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item![1])}</li>
          ))}
        </ol>
      );
    }

    return (
      <p key={blockIndex}>
        {lines.map((line, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 && <br />}
            {renderInlineMarkdown(line.replace(/^#{1,3}\s+/, ""))}
          </span>
        ))}
      </p>
    );
  });
}

type StreamedAnswer = {
  insight: string;
  receiptId?: string;
};

async function readStreamedAnswer(
  response: Response,
  onInsight: (insight: string) => void,
): Promise<StreamedAnswer> {
  const reader = response.body?.getReader();
  if (!reader) throw new QueryError(ANSWER_RETRY_MESSAGE, true);

  const decoder = new TextDecoder();
  let buffer = "";
  let partialInsight = "";
  let insight = "";
  let receiptId: string | undefined;
  let receivedAnswer = false;

  function readFrame(frame: string) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;

    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new QueryError(ANSWER_RETRY_MESSAGE, true);
    }

    if (typeof value !== "object" || value === null) {
      throw new QueryError(ANSWER_RETRY_MESSAGE, true);
    }

    const frameData = value as Record<string, unknown>;
    if (frameData.type === "token" && typeof frameData.value === "string") {
      partialInsight += frameData.value;
      onInsight(partialInsight);
      return;
    }
    if (frameData.type === "error") {
      const message = typeof frameData.error === "string" ? frameData.error : ANSWER_RETRY_MESSAGE;
      throw new QueryError(message, true);
    }
    if (frameData.type === "done") {
      const finalInsight = typeof frameData.insight === "string" ? frameData.insight.trim() : "";
      if (!finalInsight) throw new QueryError(ANSWER_RETRY_MESSAGE, true);
      insight = finalInsight;
      receiptId = typeof frameData.receiptId === "string" ? frameData.receiptId : undefined;
      receivedAnswer = true;
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) readFrame(frame);
      if (done) {
        if (buffer.trim()) readFrame(buffer);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!receivedAnswer) throw new QueryError(ANSWER_RETRY_MESSAGE, true);
  return { insight, receiptId };
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizePrice(raw: string) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0.1";
  return String(Number(parsed.toFixed(4)));
}

export default function QueryVault({
  providerAddress,
  onProviderAddressChange,
  treasuryAccount,
  onQueryPayment,
  activeTab,
  onTabChange,
}: QueryVaultProps) {
  const walletContext = useContext(WalletContext);
  const walletAccountId = walletContext?.accountId ?? null;
  const [vaults, setVaults] = useState<MarketplaceVault[]>(DEMO_VAULTS);
  const [selectedVaultId, setSelectedVaultId] = useState<string>(DEMO_VAULTS[0].id);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<QueryStage>("idle");
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
  const [vaultSearch, setVaultSearch] = useState("");
  const [isPublishing, setIsPublishing] = useState(false);
  const [paidPublishFee, setPaidPublishFee] = useState<{ accountId: string; txHash: string } | null>(null);
  const [confirmEjectId, setConfirmEjectId] = useState<string | null>(null);
  const [ejectingId, setEjectingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const runIdRef = useRef(0);
  const answerRef = useRef<HTMLDivElement>(null);

  const isExecuting = stage === "paying" || stage === "answering";

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    let active = true;

    const refreshPublishedVaults = async () => {
      try {
        const response = await fetch("/api/vaults", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { vaults?: MarketplaceVault[] };
        if (!active || !Array.isArray(result.vaults)) return;
        setVaults((current) => [
          ...DEMO_VAULTS,
          ...result.vaults!,
          ...current.filter((vault) => vault.source === "session"),
        ]);
      } catch {
        // Keep the sample marketplace usable while shared storage is unavailable.
      }
    };

    void refreshPublishedVaults();
    const intervalId = window.setInterval(() => void refreshPublishedVaults(), 30_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Bring the answer area into view as soon as the answer starts loading, so
  // on small screens the reader lands on it without hunting.
  useEffect(() => {
    if (stage !== "answering" && stage !== "ready") return;
    answerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [stage]);

  const selectedVault = vaults.find((vault) => vault.id === selectedVaultId) ?? vaults[0];
  const selectedQueryTotal = selectedVault ? addNearAmounts(selectedVault.priceNear, QUERY_FEE_NEAR) : "0";
  const searchTerms = vaultSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredVaults = searchTerms.length === 0
    ? vaults
    : vaults.filter((vault) => {
      const haystack = `${vault.title} ${vault.description}`.toLowerCase();
      return searchTerms.every((term) => haystack.includes(term));
    });
  const myVaults = vaults.filter((vault) => (
    vault.source === "session"
    || (vault.source === "published" && vault.publisherAddress === walletAccountId)
  ));
  const hasPaidPublishFee = Boolean(walletAccountId) && paidPublishFee?.accountId === walletAccountId;
  const parsedPrice = Number(draftPrice);
  const providerAddressValid = isValidNearAccountId(providerAddress);
  const canPublish = draftFiles.length > 0
    && draftTitle.trim().length > 0
    && Number.isFinite(parsedPrice)
    && parsedPrice > 0
    && providerAddressValid;

  function resetQueryState() {
    runIdRef.current += 1;
    setQuery("");
    setAnswer(null);
    setStage("idle");
    setRetryContext(null);
    setErrorMessage(null);
  }

  function handleSelectVault(vaultId: string) {
    if (vaultId === selectedVaultId) return;
    setSelectedVaultId(vaultId);
    resetQueryState();
  }

  function failQuery(runId: number, message: string) {
    if (runId !== runIdRef.current) return;
    setErrorMessage(message);
    setStage("error");
  }

  async function executeAnswer(execution: QueryExecution, runId: number) {
    const { vault } = execution;

    setStage("answering");
    setAnswer(null);
    setErrorMessage(null);

    const payload: Record<string, unknown> = {
      query: execution.submittedQuery,
      txHash: execution.txHash,
      feeTxHash: execution.feeTxHash,
      payerAccountId: execution.payerAccountId,
      queryPrice: vault.priceNear,
    };
    // Sample and published vaults are loaded on the server. Raw dataset text
    // stays in KV and is never sent back to the browser.
    if (vault.source === "sample" || vault.source === "published") {
      payload.vaultId = vault.id;
    } else {
      payload.dataset = vault.dataset ?? "";
    }

    // The answer endpoint verifies the payment itself, so the browser goes
    // straight from the wallet to the answer with a single request.
    let response: Response;
    try {
      response = await fetch("/api/query-tee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new QueryError(ANSWER_RETRY_MESSAGE, true);
    }

    if (runId !== runIdRef.current) return;

    if (!response.ok) {
      let code: string | undefined;
      try {
        const result: unknown = await response.json();
        if (typeof result === "object" && result !== null && "code" in result && typeof result.code === "string") {
          code = result.code;
        }
      } catch {
        // HTTP failures may not include a JSON body.
      }
      throw toQueryError(response.status, code);
    }

    let insight = "";
    let receiptId: string | undefined;
    let privacy: PrivacyReceiptData | null = null;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const streamed = await readStreamedAnswer(response, (partialInsight) => {
        if (runId === runIdRef.current) {
          setAnswer({ vaultTitle: vault.title, insight: partialInsight });
        }
      });
      insight = streamed.insight;
      receiptId = streamed.receiptId;
    } else {
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        throw new QueryError(ANSWER_RETRY_MESSAGE, true);
      }

      const record = typeof result === "object" && result !== null
        ? result as Record<string, unknown>
        : {};
      insight = typeof record.insight === "string" ? record.insight.trim() : "";
      receiptId = typeof record.receiptId === "string" ? record.receiptId : undefined;
      privacy = parsePrivacyReceipt(record.privacy);
    }

    if (!insight || (receiptId && receiptId !== execution.txHash)) {
      throw new QueryError(ANSWER_RETRY_MESSAGE, true);
    }

    setAnswer({ vaultTitle: vault.title, insight, privacy });
    setStage("ready");
    setRetryContext(null);
  }

  async function runExecution(execution: QueryExecution, runId: number) {
    try {
      await executeAnswer(execution, runId);
    } catch (error) {
      if (error instanceof QueryError) {
        if (runId === runIdRef.current) setRetryContext(error.canRetry ? execution : null);
        failQuery(runId, error.message);
      } else {
        if (runId === runIdRef.current) setRetryContext(execution);
        failQuery(runId, ANSWER_RETRY_MESSAGE);
      }
    }
  }

  async function handleRunQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuery = query.trim();
    if (!submittedQuery || isExecuting || !selectedVault) return;

    const vault = selectedVault;
    const wallet = walletContext?.wallet;

    if (!walletAccountId || !walletContext || !wallet) {
      setNotification("Connect your wallet to continue.");
      try {
        await walletContext?.signIn();
      } catch {
        setNotification("Couldn't open your wallet. Please try again.");
      }
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    setStage("paying");
    setAnswer(null);
    setRetryContext(null);
    setErrorMessage(null);

    // The vault price goes to the publisher and the platform fee to the
    // treasury: two transfers, approved together in one wallet prompt.
    const transfers: NearTransferRequest[] = [
      { receiverId: vault.seller || treasuryAccount, amountNear: vault.priceNear },
    ];
    if (isFeeEnabled(QUERY_FEE_NEAR)) {
      transfers.push({ receiverId: PLATFORM_TREASURY, amountNear: QUERY_FEE_NEAR });
    }

    let txHash: string | null = null;
    let feeTxHash: string | undefined;
    try {
      const hashes = await transferNearBatch(walletContext, transfers);
      txHash = hashes[0] ?? null;
      feeTxHash = hashes[1];
    } catch (error) {
      failQuery(runId, toPaymentErrorMessage(error));
      return;
    }

    if (runId !== runIdRef.current) return;
    if (!txHash) {
      failQuery(runId, "We couldn't complete your question. Check your wallet before trying again.");
      return;
    }

    onQueryPayment({
      kind: "query",
      amountNear: addNearAmounts(...transfers.map((transfer) => transfer.amountNear)),
      title: vault.title,
      txHash,
    });

    await runExecution({
      vault,
      submittedQuery,
      payerAccountId: walletAccountId,
      txHash,
      feeTxHash,
    }, runId);
  }

  async function handleRetryAnswer() {
    if (!retryContext || isExecuting) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    await runExecution(retryContext, runId);
  }

  function removeVaultFromList(vault: MarketplaceVault, message: string) {
    const remaining = vaults.filter((entry) => entry.id !== vault.id);
    setVaults(remaining);
    setNotification(message);
    setConfirmEjectId(null);

    if (selectedVaultId === vault.id) {
      setSelectedVaultId(remaining[0]?.id ?? "");
      resetQueryState();
    }
  }

  function canEject(vault: MarketplaceVault) {
    return vault.source === "session"
      || (vault.source === "published" && Boolean(walletAccountId) && vault.publisherAddress === walletAccountId);
  }

  async function handleEject(vaultId: string) {
    const vault = vaults.find((entry) => entry.id === vaultId);
    if (!vault || !canEject(vault) || ejectingId) return;

    if (vault.source === "session") {
      removeVaultFromList(vault, `"${vault.title}" was removed.`);
      return;
    }

    const wallet = walletContext?.wallet;
    if (!walletAccountId || !wallet) {
      setNotification("Connect the wallet that published this vault.");
      return;
    }
    if (typeof wallet.signMessage !== "function") {
      setNotification("Your wallet can't confirm ownership. Try MyNearWallet or Meteor.");
      return;
    }

    setEjectingId(vault.id);
    try {
      // Prove ownership with a free, off-chain NEP-413 signature (no transaction).
      const nonce = window.crypto.getRandomValues(new Uint8Array(OWNERSHIP_NONCE_BYTES));
      const message = buildUnpublishMessage(vault.id, new Date().toISOString());
      let signed: WalletSignature;
      try {
        signed = await signMessageWithWallet(wallet, {
          message,
          recipient: OWNERSHIP_RECIPIENT,
          // Must be a real Buffer: Meteor's extension bridge JSON-serializes
          // requests, which keeps a Buffer intact but mangles a Uint8Array.
          nonce: Buffer.from(nonce),
        });
      } catch (error) {
        console.warn("[Unpublish] Wallet signature failed:", error);
        if (isUserCancellation(error)) {
          setNotification("Unpublish cancelled. Your vault is still live.");
        } else {
          const reason = error instanceof Error && error.message ? ` (${error.message})` : "";
          setNotification(`Your wallet couldn't confirm ownership${reason}. Your vault is still live.`);
        }
        return;
      }

      const response = await fetch("/api/vaults", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vaultId: vault.id,
          accountId: signed.accountId || walletAccountId,
          publicKey: signed.publicKey,
          signature: signed.signature,
          nonce: window.btoa(String.fromCharCode(...nonce)),
          message,
        }),
      });
      if (response.ok || response.status === 404) {
        removeVaultFromList(vault, `"${vault.title}" was unpublished.`);
        return;
      }
      const result = await response.json().catch(() => ({})) as { error?: string };
      setNotification(result.error || "Couldn't unpublish this vault. Please try again.");
    } catch {
      setNotification("Couldn't unpublish this vault. Please try again.");
    } finally {
      setEjectingId(null);
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
      setDraftNotice(`Skipped ${rejected.join(", ")}. Add non-empty .csv, .txt, or .md files.`);
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
      setNotification("Connect your wallet to publish.");
      try {
        await walletContext?.signIn();
      } catch {
        setNotification("Couldn't open your wallet. Please try again.");
      }
      return;
    }

    const seller = providerAddress.trim();
    if (!isValidNearAccountId(seller)) {
      setNotification("Enter a valid payout account.");
      return;
    }

    if (isPublishing) return;
    setIsPublishing(true);
    try {
      await publishVault(walletAccountId, seller);
    } finally {
      setIsPublishing(false);
    }
  }

  async function publishVault(publisherAddress: string, seller: string) {
    // One-time publishing fee, paid before the vault is saved. If saving fails
    // afterwards, the paid fee is kept so a retry doesn't charge again.
    let publishFeeTxHash: string | undefined;
    if (isFeeEnabled(PUBLISH_FEE_NEAR)) {
      if (paidPublishFee?.accountId === publisherAddress) {
        publishFeeTxHash = paidPublishFee.txHash;
      } else {
        if (!walletContext?.wallet) {
          setNotification("Connect your wallet to publish.");
          return;
        }
        try {
          const result = await transferNear(walletContext, PLATFORM_TREASURY, PUBLISH_FEE_NEAR);
          publishFeeTxHash = extractTransactionHash(result);
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          setNotification(
            /insufficient|not enough|balance/.test(message)
              ? "Not enough NEAR in your wallet for the publishing fee."
              : "Publishing cancelled. You weren't charged.",
          );
          return;
        }
        if (!publishFeeTxHash) {
          setNotification("We couldn't confirm the publishing fee. Check your wallet activity before trying again.");
          return;
        }
        setPaidPublishFee({ accountId: publisherAddress, txHash: publishFeeTxHash });
        onQueryPayment({ kind: "send", amountNear: PUBLISH_FEE_NEAR, title: "Publishing fee", txHash: publishFeeTxHash });
      }
    }

    const title = draftTitle.trim();
    const dataset = draftFiles.map((file) => `### ${file.name}\n${file.content}`).join("\n\n");
    let publishedVault: MarketplaceVault;
    try {
      const response = await fetch("/api/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: draftDescription.trim() || "Published through BlindSight.",
          priceNear: normalizePrice(draftPrice),
          publisherAddress,
          payoutAddress: seller,
          dataset,
          publishFeeTxHash,
        }),
      });
      const result = await response.json() as { vault?: MarketplaceVault; error?: string; code?: string };
      if (!response.ok || !result.vault) {
        // A fee that can never be accepted shouldn't be offered for reuse.
        if (result.code === "PUBLISH_FEE_ALREADY_USED" || result.code === "PUBLISH_FEE_WRONG_PAYER") {
          setPaidPublishFee(null);
        }
        setNotification(
          publishFeeTxHash && result.code !== "PUBLISH_FEE_ALREADY_USED"
            ? `${result.error || "Couldn't publish this vault."} Your publishing fee is saved, so trying again won't charge you twice.`
            : result.error || "Couldn't publish this vault. Please try again.",
        );
        return;
      }
      publishedVault = result.vault;
    } catch {
      setNotification(
        publishFeeTxHash
          ? "Couldn't publish this vault. Your publishing fee is saved, so trying again won't charge you twice."
          : "Couldn't publish this vault. Please try again.",
      );
      return;
    }

    setPaidPublishFee(null);

    setVaults((current) => [publishedVault, ...current.filter((vault) => vault.id !== publishedVault.id)]);
    setSelectedVaultId(publishedVault.id);
    resetQueryState();
    onTabChange("gateway");
    setNotification(`"${publishedVault.title}" is live.`);
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
          className="animate-fade-up space-y-4"
        >
          {selectedVault ? (
            <>
              <div className={`${PANEL} p-4 sm:p-5`}>
                <label className="flex flex-col gap-1.5">
                  <span className={FIELD_LABEL}>Vault</span>
                  <select
                    value={selectedVault.id}
                    onChange={(event) => handleSelectVault(event.target.value)}
                    disabled={isExecuting}
                    className={`${INPUT} pr-8`}
                  >
                    {vaults.map((vault) => (
                      <option key={vault.id} value={vault.id}>
                        {vault.title}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="mt-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400">{selectedVault.category}</p>
                    <h2 className="mt-0.5 text-base font-semibold text-white">{selectedVault.title}</h2>
                    <p className="mt-1.5 text-sm leading-6 text-slate-400">{selectedVault.description}</p>
                  </div>
                  <span className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-white">
                    {selectedVault.priceNear} NEAR
                  </span>
                </div>
              </div>

              <form onSubmit={handleRunQuery} className={`${PANEL} grid gap-3 p-4 sm:p-5`}>
                <label htmlFor="vault-query" className="text-sm font-medium text-white">
                  Your question
                </label>
                <textarea
                  id="vault-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  disabled={isExecuting}
                  rows={3}
                  maxLength={500}
                  placeholder="What are the biggest risks in this dataset?"
                  className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-base leading-7 text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-cyan-400/60 disabled:opacity-60 sm:text-sm sm:leading-6"
                />
                <div className="flex flex-wrap gap-2">
                  {QUERY_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setQuery(suggestion)}
                      disabled={isExecuting}
                      className="min-h-9 rounded-full border border-white/10 bg-white/[0.03] px-3 text-xs text-slate-300 transition hover:border-cyan-400/40 hover:text-white disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <div className="mt-1 flex flex-col gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-end sm:justify-between">
                  <dl aria-label="Price breakdown" className="grid gap-1 text-xs sm:min-w-56">
                    <div className="flex justify-between gap-6 text-slate-400">
                      <dt>Vault price</dt>
                      <dd className="text-slate-200">{selectedVault.priceNear} NEAR</dd>
                    </div>
                    {isFeeEnabled(QUERY_FEE_NEAR) && (
                      <div className="flex justify-between gap-6 text-slate-400">
                        <dt>Platform fee</dt>
                        <dd className="text-slate-200">{QUERY_FEE_NEAR} NEAR</dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-6 border-t border-white/10 pt-1 text-sm font-medium text-white">
                      <dt>Total</dt>
                      <dd>{selectedQueryTotal} NEAR</dd>
                    </div>
                  </dl>
                  <button
                    type="submit"
                    disabled={!query.trim() || isExecuting}
                    className={`${PRIMARY_BUTTON} w-full sm:w-auto`}
                  >
                    {stage === "paying"
                      ? "Continue in wallet…"
                      : stage === "answering"
                        ? "Getting your answer…"
                        : `Pay ${selectedQueryTotal} NEAR & Ask`}
                  </button>
                </div>
              </form>

              {(stage === "answering" || answer || errorMessage) && (
                <div ref={answerRef} id="query-answer" aria-live="polite" className="scroll-mt-24">
                  {stage === "answering" && !answer && (
                    <div className={`${PANEL} p-5 sm:p-6`} role="status">
                      <p className="text-sm font-medium text-white">Getting your answer…</p>
                      <div aria-hidden="true" className="mt-4 space-y-3">
                        <div className="h-3 w-11/12 animate-pulse rounded bg-white/10" />
                        <div className="h-3 w-10/12 animate-pulse rounded bg-white/10" />
                        <div className="h-3 w-8/12 animate-pulse rounded bg-white/10" />
                      </div>
                    </div>
                  )}

                  {errorMessage && stage === "error" && (
                    <div role="alert" className="rounded-2xl border border-rose-400/25 bg-rose-500/[0.06] p-4 sm:p-5">
                      <p className="text-sm leading-6 text-rose-100">{errorMessage}</p>
                      {retryContext && (
                        <button
                          type="button"
                          onClick={() => void handleRetryAnswer()}
                          className={`${SECONDARY_BUTTON} mt-3`}
                        >
                          Try again
                        </button>
                      )}
                    </div>
                  )}

                  {answer && (stage === "answering" || stage === "ready") && (
                    <article className={`${PANEL} p-5 sm:p-7`}>
                      <header className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-cyan-300">Answer</p>
                          <h3 className="mt-1 text-base font-semibold text-white">{answer.vaultTitle}</h3>
                        </div>
                      </header>
                      <div className="mt-5 max-w-prose space-y-4 break-words text-[15px] leading-7 text-slate-100 sm:text-base">
                        {renderInsight(answer.insight)}
                      </div>
                      {stage === "ready" && answer.privacy && <PrivacyReceipt receipt={answer.privacy} />}
                    </article>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className={`${PANEL} px-4 py-10 text-center`}>
              <p className="text-sm text-slate-300">No vaults are available right now.</p>
              <button type="button" onClick={() => onTabChange("publish")} className={`${SECONDARY_BUTTON} mt-4`}>
                Publish a vault
              </button>
            </div>
          )}
        </section>
      )}

      {activeTab === "explorer" && (
        <section
          role="tabpanel"
          id="explorer-panel"
          aria-labelledby="explorer-tab"
          className="animate-fade-up space-y-4"
        >
          <div>
            <h2 className="text-lg font-semibold text-white">Browse vaults</h2>
            <p className="mt-1 text-sm text-slate-400">Choose a vault to ask it a question.</p>
          </div>

          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={vaultSearch}
              onChange={(event) => setVaultSearch(event.target.value)}
              placeholder="Search vaults by title or description"
              aria-label="Search vaults"
              className={`${INPUT} pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden`}
            />
            {vaultSearch && (
              <button
                type="button"
                onClick={() => setVaultSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>

          {filteredVaults.length === 0 && (
            <div className={`${PANEL} px-4 py-8 text-center`}>
              <p className="text-sm text-slate-300">No vaults match &ldquo;{vaultSearch.trim()}&rdquo;.</p>
              <button
                type="button"
                onClick={() => setVaultSearch("")}
                className="mt-2 text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
              >
                Clear search
              </button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {filteredVaults.map((vault) => {
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
                  className={`flex h-full flex-col rounded-2xl border p-4 text-left transition sm:p-5 ${
                    isSelected
                      ? "border-cyan-400/50 bg-cyan-500/[0.06]"
                      : "border-white/10 bg-slate-900/70 hover:border-white/20 hover:bg-slate-900"
                  }`}
                >
                  <span className="flex items-center justify-between gap-3 text-xs text-slate-400">
                    {vault.category}
                  </span>
                  <span className="mt-1.5 block text-base font-semibold text-white">{vault.title}</span>
                  <span className="mt-1.5 line-clamp-2 block text-sm leading-6 text-slate-400">
                    {vault.description}
                  </span>
                  <span className="mt-auto flex items-center justify-between gap-3 pt-4 text-sm">
                    <span className="font-medium text-white">{vault.priceNear} NEAR</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === "publish" && (
        <section
          role="tabpanel"
          id="publish-panel"
          aria-labelledby="publish-tab"
          className="animate-fade-up space-y-4"
        >
          <div>
            <h2 className="text-lg font-semibold text-white">Publish a vault</h2>
            <p className="mt-1 text-sm text-slate-400">
              Add a dataset and set a price per question. Buyers get answers, never your files.
            </p>
          </div>

          <form onSubmit={handlePublish} className={`${PANEL} grid gap-4 p-4 sm:p-5`}>
            <div>
              <span className={`${FIELD_LABEL} mb-1.5 block`}>Files</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".csv,.txt,.md,.markdown"
                className="sr-only"
                onChange={handleDraftFileChange}
                aria-label="Choose .csv, .txt, or .md files"
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
                className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 text-center transition ${
                  isDragging
                    ? "border-cyan-400 bg-cyan-500/10"
                    : "border-white/15 bg-slate-950/40 hover:border-cyan-400/50"
                }`}
              >
                <span className="text-sm font-medium text-white">Drop .csv, .txt, or .md files</span>
                <span className="mt-1 text-sm text-slate-400">
                  or <span className="text-cyan-300 underline underline-offset-2">browse</span>
                </span>
              </div>
              {draftNotice && (
                <p role="status" className="mt-2 text-xs leading-5 text-amber-200">{draftNotice}</p>
              )}
            </div>

            {draftFiles.length > 0 && (
              <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-slate-950/40 px-3">
                {draftFiles.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-100">{file.name}</span>
                      <span className="block text-xs text-slate-500">{formatBytes(file.size)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeDraftFile(file.id)}
                      className="min-h-11 shrink-0 px-2 text-xs text-slate-400 transition hover:text-rose-300"
                      aria-label={`Remove ${file.name}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
              <label className="min-w-0">
                <span className={`${FIELD_LABEL} mb-1.5 block`}>Title</span>
                <input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  maxLength={80}
                  placeholder="Q4 Revenue & Retention"
                  className={INPUT}
                />
              </label>
              <label>
                <span className={`${FIELD_LABEL} mb-1.5 block`}>Price per question</span>
                <span className="relative block">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={draftPrice}
                    onChange={(event) => setDraftPrice(event.target.value)}
                    className={`${INPUT} pr-14`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                    NEAR
                  </span>
                </span>
              </label>
            </div>

            <label className="block">
              <span className={`${FIELD_LABEL} mb-1.5 block`}>Description</span>
              <textarea
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                rows={2}
                maxLength={220}
                placeholder="What can buyers learn from this vault?"
                className={`${INPUT} min-h-20 resize-y py-2.5 leading-6`}
              />
            </label>

            <label className="block">
              <span className={`${FIELD_LABEL} mb-1.5 block`}>Receive payments at</span>
              <input
                value={providerAddress}
                onChange={(event) => onProviderAddressChange(event.target.value)}
                maxLength={64}
                placeholder={walletAccountId ?? "Your NEAR account"}
                className={INPUT}
              />
              {providerAddress && !providerAddressValid && (
                <span className="mt-1.5 block text-xs text-rose-300">Enter a valid NEAR account.</span>
              )}
            </label>

            {isFeeEnabled(PUBLISH_FEE_NEAR) && (
              <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
                <div>
                  <p className="text-sm font-medium text-white">Publishing fee</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-400">
                    {hasPaidPublishFee
                      ? "Already paid. Finish publishing at no extra cost."
                      : "One-time, paid to BlindSight when your vault goes live."}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium text-white">{PUBLISH_FEE_NEAR} NEAR</span>
              </div>
            )}

            <button type="submit" disabled={!canPublish || isPublishing} className={`${PRIMARY_BUTTON} w-full`}>
              {isPublishing
                ? "Publishing…"
                : isFeeEnabled(PUBLISH_FEE_NEAR) && !hasPaidPublishFee
                  ? `Pay ${PUBLISH_FEE_NEAR} NEAR & Publish`
                  : "Publish"}
            </button>
          </form>

          {myVaults.length > 0 && (
            <div className={PANEL}>
              <h3 className="border-b border-white/10 px-4 py-3 text-sm font-medium text-white">Your vaults</h3>
              <ul className="divide-y divide-white/[0.06]">
                {myVaults.map((vault) => {
                  const isConfirming = confirmEjectId === vault.id;
                  const isEjecting = ejectingId === vault.id;
                  const actionLabel = vault.source === "published" ? "Unpublish" : "Remove";
                  return (
                    <li key={vault.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">{vault.title}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{vault.priceNear} NEAR per question</div>
                        </div>
                        {canEject(vault) && !isConfirming && (
                          <button
                            type="button"
                            onClick={() => setConfirmEjectId(vault.id)}
                            disabled={Boolean(ejectingId)}
                            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 transition hover:border-rose-400/30 hover:bg-rose-500/[0.06] hover:text-rose-200 disabled:opacity-50"
                            aria-label={`${actionLabel} ${vault.title}`}
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                            {actionLabel}
                          </button>
                        )}
                      </div>

                      {isConfirming && (
                        <div
                          role="group"
                          aria-label={`Confirm ${actionLabel.toLowerCase()}`}
                          className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/[0.05] p-3"
                        >
                          <p className="text-sm leading-6 text-slate-200">
                            {vault.source === "published"
                              ? "Unpublish this vault? It will be removed from the marketplace and its data deleted. This can't be undone."
                              : "Remove this vault from your list?"}
                          </p>
                          {vault.source === "published" && (
                            <p className="mt-1 text-xs leading-5 text-slate-400">
                              Your wallet will ask you to sign a message to confirm you own it. No fee is charged.
                            </p>
                          )}
                          <div className="mt-3 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmEjectId(null)}
                              disabled={isEjecting}
                              className="min-h-9 rounded-lg border border-white/10 px-3 text-xs font-medium text-slate-300 transition hover:bg-white/[0.06] disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleEject(vault.id)}
                              disabled={isEjecting}
                              className="min-h-9 rounded-lg bg-rose-500/90 px-3 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:opacity-60"
                            >
                              {isEjecting ? "Unpublishing…" : actionLabel}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {notification && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-xl border border-white/10 bg-slate-900/95 px-4 py-3 text-sm text-slate-100 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:right-5 sm:bottom-5"
        >
          {notification}
        </div>
      )}
    </>
  );
}
