"use client";

import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { executeDataPayout } from "@/lib/executeSettlement";

type VaultFile = {
  name: string;
  size: number;
  content: string;
};

type QueryResponse = {
  insight?: string;
  attestationToken?: string;
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

function getFileRowCount(file: VaultFile) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const content = file.content.trim();
  if (!content) return 0;

  if (extension === "json") {
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed.length;
      return 1;
    } catch {
      return content.split(/\r?\n/).filter((line) => line.trim()).length;
    }
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  return extension === "csv" || extension === "tsv" ? Math.max(0, lines.length - 1) : lines.length;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [vaultQueued, setVaultQueued] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [ciphertext, setCiphertext] = useState("");
  const [isValuing, setIsValuing] = useState(false);
  const [agentBid, setAgentBid] = useState<AgentBid | null>(null);
  const [acceptedBid, setAcceptedBid] = useState<AgentBid | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [insight, setInsight] = useState("");
  const [attestationToken, setAttestationToken] = useState("");
  const [settlementHash, setSettlementHash] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [providerAddress, setProviderAddress] = useState("provider.near");
  const [isRunning, setIsRunning] = useState(false);
  const [buyerBalance, setBuyerBalance] = useState(0);
  const [isDepositing, setIsDepositing] = useState(false);
  const [runCount, setRunCount] = useState(0);

  async function handleDeposit() {
    if (isDepositing) return;
    setIsDepositing(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    setBuyerBalance(50);
    setIsDepositing(false);
  }

  async function addFiles(selectedFiles: FileList | File[]) {
    if (isEncrypting) return;
    const nextFiles: VaultFile[] = [];
    const rejectedFiles: string[] = [];

    for (const file of Array.from(selectedFiles)) {
      if (!/\.(csv|json|txt|tsv)$/i.test(file.name) || file.size > 1_000_000) {
        rejectedFiles.push(file.name);
        continue;
      }
      nextFiles.push({ name: file.name, size: file.size, content: await file.text() });
    }

    if (nextFiles.length) {
      setFiles((current) => [...current, ...nextFiles]);
      setInsight("");
      setAttestationToken("");
      setSettlementHash("");
      setSuccessMessage("");
    }
    setCiphertext("");
    setAgentBid(null);
    setAcceptedBid(null);
    setErrorMessage(
      rejectedFiles.length
        ? `Unsupported or oversized file${rejectedFiles.length === 1 ? "" : "s"}: ${rejectedFiles.join(", ")}. Use CSV, JSON, TXT, or TSV files under 1 MB.`
        : "",
    );
    setVaultQueued(false);
  }

  async function handleEncryptPayload() {
    if (!files.length || isEncrypting) return;
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
    if (!files.length || !vaultQueued || isValuing) return;

    const rowCount = files.reduce((total, file) => total + getFileRowCount(file), 0);
    const fileSizeBytes = files.reduce((total, file) => total + file.size, 0);
    if (rowCount < 1) {
      setErrorMessage("The uploaded files do not contain any billable rows for valuation.");
      return;
    }

    setIsValuing(true);
    setErrorMessage("");
    setAgentBid(null);
    setAcceptedBid(null);

    try {
      const response = await fetch("/api/agent-bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rowCount, fileCount: files.length, fileSizeBytes }),
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
    if (isEncrypting || isValuing) return;
    void addFiles(event.dataTransfer.files);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || files.length === 0 || !vaultQueued || !acceptedBid || buyerBalance < 10 || isRunning) return;

    setIsRunning(true);
    setErrorMessage("");
    setSuccessMessage("");
    setInsight("");
    setAttestationToken("");
    setSettlementHash("");

    try {
      const dataset = files.map((file) => `### ${file.name}\n${file.content}`).join("\n\n");
      if (dataset.length > 60_000) {
        throw new Error("Combined dataset exceeds the 60,000 character API limit.");
      }

      const response = await fetch("/api/query-tee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset,
          query: query.trim(),
          ciphertextPreview: ciphertext,
          encryptionMode: "mock-aes-256",
        }),
      });
      const result = (await response.json()) as QueryResponse;
      if (!response.ok) throw new Error(result.error || "Confidential query failed.");
      if (!result.insight || !result.attestationToken) {
        throw new Error("The inference response was incomplete.");
      }

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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Confidential query failed.");
    } finally {
      setIsRunning(false);
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
            <button className="flex items-center gap-2 border border-white/10 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[#a4b1ab] transition hover:border-[#b5ff82]/40 hover:text-white">
              <span className="size-1.5 rounded-full bg-[#f0b66a]" />
              <span>NEAR Testnet</span>
              <span className="text-[#718079]">⌄</span>
            </button>
            <button
              className="grid size-9 place-items-center border border-white/10 font-mono text-xs text-[#99a8a1] transition hover:border-white/25 hover:text-white"
              aria-label="Open account menu"
              title="Account"
            >
              JD
            </button>
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
                accept=".csv,.json,.txt,.tsv,text/csv,application/json,text/plain,text/tab-separated-values"
                className="sr-only"
                disabled={isEncrypting || isValuing}
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
                onClick={() => { if (!isEncrypting && !isValuing) fileInputRef.current?.click(); }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (!isEncrypting && !isValuing && (event.key === "Enter" || event.key === " ")) {
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
                <span className="mt-5 font-mono text-[9px] uppercase tracking-[0.11em] text-[#59665f]">CSV · JSON · TXT · TSV · under 1 MB each</span>
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
                          setVaultQueued(false);
                          setCiphertext("");
                          setAgentBid(null);
                          setAcceptedBid(null);
                          setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
                          setInsight("");
                          setAttestationToken("");
                          setSettlementHash("");
                          setSuccessMessage("");
                        }}
                        disabled={isEncrypting || isValuing}
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
                disabled={files.length === 0 || isEncrypting}
                className="mt-5 flex h-10 w-full items-center justify-center gap-2 bg-[#b5ff82] font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[#111711] transition hover:bg-[#c6ff9d] disabled:cursor-not-allowed disabled:bg-[#344036] disabled:text-[#7b897d]"
              >
                <span>{isEncrypting ? "Encrypting payload locally..." : "Encrypt Payload Locally"}</span><span aria-hidden="true">{isEncrypting ? "···" : "↗"}</span>
              </button>
              <div className="mt-3 flex justify-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[#56635d]">
                <span>{vaultQueued ? "Payload ready in local preview" : "Local encryption required to query"}</span>
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

          <section className="flex min-w-0 flex-col border border-white/[0.09] bg-[#0d1314]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-[#72d9d0]">02</span>
                <h2 className="text-[13px] font-medium tracking-wide">Research Console</h2>
              </div>
              <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[#78857f]">
                <span className="size-1.5 rounded-full bg-[#72d9d0] shadow-[0_0_8px_#72d9d0]" />
                Private session
              </div>
            </div>

            <div className="flex flex-1 flex-col p-5">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-[#72d9d0]/20 bg-[#72d9d0]/[0.04] px-4 py-3">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#829088]">Agent Escrow Balance</div>
                  <div className="mt-1 font-mono text-[16px] font-semibold text-[#72d9d0]">{buyerBalance} USDC</div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeposit()}
                  disabled={isDepositing || buyerBalance >= 50}
                  className="flex h-9 items-center justify-center gap-2 border border-[#b5ff82]/30 px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#b5ff82] transition hover:border-[#b5ff82]/60 hover:bg-[#b5ff82]/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>{isDepositing ? "Funding agent..." : buyerBalance >= 50 ? "Agent funded" : "Deposit 50 USDC to Agent"}</span>
                  {isDepositing && <span aria-hidden="true">···</span>}
                </button>
              </div>
              <div className="mb-3 flex items-center justify-between">
                <label htmlFor="research-query" className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#829088]">Inference prompt</label>
                <span className="font-mono text-[9px] text-[#59665f]">NATURAL LANGUAGE</span>
              </div>
              <form onSubmit={handleSubmit}>
                <div className="border border-white/[0.1] bg-[#090e0f] transition focus-within:border-[#72d9d0]/50">
                  <div className="flex items-start gap-3 px-4 pt-4">
                    <span className="mt-0.5 font-mono text-[12px] text-[#72d9d0]">&gt;_</span>
                    <textarea
                      id="research-query"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder="Ask a question of private data..."
                      className="min-h-[76px] flex-1 resize-y bg-transparent text-[13px] leading-6 text-[#d5ded8] outline-none placeholder:text-[#526059]"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-3">
                    <span className="font-mono text-[9px] text-[#64716b]">{query.length} / 500 <span className="mx-2 text-[#3b4741]">|</span> Context: provider vault</span>
                    <button
                      type="submit"
                      disabled={!query.trim() || files.length === 0 || !vaultQueued || !acceptedBid || buyerBalance < 10 || isRunning}
                      className="flex h-9 items-center gap-3 bg-[#72d9d0] px-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[#071312] transition hover:bg-[#8ce9df] disabled:cursor-wait disabled:opacity-60"
                    >
                      <span>{isRunning ? "Querying dataset" : "Run Confidential Query"}</span>
                      <span aria-hidden="true">{isRunning ? "···" : "↗"}</span>
                    </button>
                  </div>
                </div>
              </form>

              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
                <label className="min-w-0">
                  <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.12em] text-[#75827b]">Provider destination</span>
                  <input
                    value={providerAddress}
                    onChange={(event) => setProviderAddress(event.target.value)}
                    maxLength={128}
                    placeholder="provider.near"
                    className="h-10 w-full border border-white/[0.1] bg-[#090e0f] px-3 font-mono text-[11px] text-[#cbd5cf] outline-none transition placeholder:text-[#526059] focus:border-[#72d9d0]/50"
                  />
                </label>
                <label>
                  <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.12em] text-[#75827b]">Accepted bid · USDC</span>
                  <input
                    value={acceptedBid?.bidAmountInUSDC ?? ""}
                    readOnly
                    placeholder="Accept agent bid"
                    className="h-10 w-full border border-white/[0.1] bg-[#090e0f] px-3 font-mono text-[11px] text-[#cbd5cf] outline-none placeholder:text-[#526059]"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-y border-white/[0.07] py-3 font-mono text-[9px] uppercase tracking-[0.1em]">
                <span className="text-[#6f7b75]">Execution output <span className="ml-2 text-[#56635d]">#{String(runCount).padStart(3, "0")}</span></span>
                <span className="flex items-center gap-2 text-[#f0b66a]"><span className="size-1.5 rounded-full bg-[#f0b66a]" /> Mock attestation · mock settlement</span>
              </div>

              {errorMessage && (
                <div role="alert" className="mt-4 border border-[#ff9a83]/25 bg-[#ff9a83]/[0.06] px-4 py-3 font-mono text-[10px] leading-5 text-[#ffad9b]">
                  <span className="mr-2 uppercase tracking-[0.1em]">Request failed</span>{errorMessage}
                </div>
              )}

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(210px,0.8fr)]">
                <div className="min-w-0 border border-white/[0.07] bg-[#0a0f10] p-4 sm:p-5">
                  <div className="mb-4 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.13em] text-[#84918a]">
                    <span className="text-[#72d9d0]">{"//"}</span> Insight report
                  </div>
                  <p aria-live="polite" className="text-[12px] leading-[1.8] text-[#bbc7c0]">
                    {isRunning ? (
                      <span className="animate-pulse text-[#72d9d0]">Sending dataset and query to NEAR AI Cloud...</span>
                    ) : insight || "No query has run. Select and queue a dataset, then submit a research prompt."}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span className="border border-[#72d9d0]/15 bg-[#72d9d0]/[0.05] px-2 py-1 font-mono text-[9px] text-[#82dcd4]">CONFIDENTIAL COMPUTE</span>
                    <span className="border border-white/[0.08] px-2 py-1 font-mono text-[9px] text-[#77847d]">{files.length ? `${files.length} PROVIDER FILE${files.length === 1 ? "" : "S"}` : "NO DATASET"}</span>
                  </div>
                </div>

                <aside className="relative overflow-hidden border border-[#b5ff82]/20 bg-[#111a14] p-4 sm:p-5">
                  <div className="absolute right-0 top-0 h-20 w-20 border-b border-l border-[#b5ff82]/10" />
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#b5ff82]">Mock TEE attestation</span>
                    <span className="grid size-7 place-items-center border border-[#b5ff82]/25 font-mono text-xs text-[#b5ff82]">{attestationToken ? "✓" : "·"}</span>
                  </div>
                  <div className="mt-4 text-[11px] font-medium leading-5 text-[#d6e2d9]">
                    {attestationToken ? "Intel TDX / NVIDIA Hardware Verification: PASSED" : "Awaiting gateway response"}
                  </div>
                  <div className="mt-1 text-[10px] text-[#78877c]">{attestationToken ? "Mock prefix accepted · not hardware proof" : "No attestation token received"}</div>
                  <div className="my-4 h-px bg-[#b5ff82]/15" />
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#718076]">Attestation token</div>
                  <code className="mt-2 block break-all font-mono text-[10px] leading-5 text-[#b5ff82]/80">{attestationToken || "--"}</code>
                  <div className="mt-4 flex items-center justify-between border-t border-[#b5ff82]/10 pt-3 font-mono text-[9px] text-[#718076]">
                    <span>TEE / SGX</span><span>NEAR AI Cloud</span>
                  </div>
                </aside>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-[#5f6d66]">
                <span>Hardware attestation is mocked for this MVP</span>
                <span className="flex items-center gap-2"><span className="text-[#f0b66a]">●</span> Settlement mocked for MVP</span>
              </div>
            </div>
          </section>
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
    </div>
  );
}
