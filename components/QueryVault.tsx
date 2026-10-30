"use client";

import { useState, type FormEvent } from "react";

type QueryVaultProps = {
  fileCount: number;
  queryReady: boolean;
  isPreparingDataset: boolean;
  buyerBalance: number;
  isDepositing: boolean;
  acceptedBid: string | null;
  providerAddress: string;
  errorMessage: string;
  rateLimitAlert: boolean;
  insight: string;
  antiProbingCheck: string;
  attestationToken: string;
  transactionHash: string;
  runCount: number;
  onProviderAddressChange: (address: string) => void;
  onDeposit: () => void;
  onLoadSampleDataset: () => Promise<void>;
  onRunQuery: (query: string) => Promise<boolean>;
};

const PIPELINE_STEPS = [
  {
    title: "Hardware-Enclave Attestation",
    detail: "AMD SEV-SNP Verified · simulated in this MVP",
  },
  {
    title: "Semantic Similarity & Rate-Limit Audit",
    detail: "Query pattern and repetition checks",
  },
  {
    title: "Differential Privacy Noise Filter",
    detail: "ε = 0.5 · simulated parameter, not formal differential privacy",
  },
  {
    title: "NEAR Escrow Payout Execution",
    detail: "Mock NEAR Intents settlement",
  },
];

function calculateEntropyScore(value: string) {
  if (!value) return 0;
  const frequencies = new Map<string, number>();
  for (const character of value.toLowerCase()) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }

  const entropy = Array.from(frequencies.values()).reduce((score, count) => {
    const probability = count / value.length;
    return score - probability * Math.log2(probability);
  }, 0);

  return Math.min(100, Math.round((entropy / Math.log2(36)) * 100));
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function QueryVault({
  fileCount,
  queryReady,
  isPreparingDataset,
  buyerBalance,
  isDepositing,
  acceptedBid,
  providerAddress,
  errorMessage,
  rateLimitAlert,
  insight,
  antiProbingCheck,
  attestationToken,
  transactionHash,
  runCount,
  onProviderAddressChange,
  onDeposit,
  onLoadSampleDataset,
  onRunQuery,
}: QueryVaultProps) {
  const [query, setQuery] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeStep, setActiveStep] = useState(-1);
  const [queriesUsed, setQueriesUsed] = useState(0);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const remainingQueries = Math.max(0, 5 - queriesUsed);

  async function handleLoadSampleDataset() {
    setIsLoadingSample(true);
    try {
      await onLoadSampleDataset();
    } finally {
      setIsLoadingSample(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || !queryReady || isExecuting || remainingQueries === 0) return;

    setQueriesUsed((used) => used + 1);
    setIsExecuting(true);
    setActiveStep(0);

    let requestFinished = false;
    const request = onRunQuery(query.trim()).then((success) => {
      requestFinished = true;
      return success;
    });

    try {
      for (let step = 0; step < PIPELINE_STEPS.length; step += 1) {
        setActiveStep(step);
        await wait(650);
        if (requestFinished) break;
      }

      const succeeded = await request;
      setActiveStep(succeeded ? PIPELINE_STEPS.length : -1);
    } finally {
      setIsExecuting(false);
    }
  }

  const entropyScore = calculateEntropyScore(query);
  const pipelineComplete = Boolean(insight) && antiProbingCheck === "PASSED";

  return (
    <section className="flex min-w-0 flex-col border border-white/[0.09] bg-[#0d1314]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-[#72d9d0]">02</span>
          <h2 className="text-[13px] font-medium tracking-wide">TEE Query Engine</h2>
        </div>
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-[#78857f]">
          <span className="size-1.5 rounded-full bg-[#72d9d0] shadow-[0_0_8px_#72d9d0]" />
          Private session · demo
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[#72d9d0]/20 bg-[#72d9d0]/[0.04] px-4 py-3">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#829088]">Agent Escrow Balance</div>
            <div className="mt-1 font-mono text-[16px] font-semibold text-[#72d9d0]">{buyerBalance} USDC</div>
          </div>
          <button
            type="button"
            onClick={onDeposit}
            disabled={isDepositing || buyerBalance >= 50}
            className="flex h-9 items-center justify-center gap-2 border border-[#b5ff82]/30 px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#b5ff82] transition hover:border-[#b5ff82]/60 hover:bg-[#b5ff82]/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDepositing ? "Funding agent..." : buyerBalance >= 50 ? "Agent funded" : "Deposit 50 USDC to Agent"}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border border-[#b5ff82]/20 bg-[#111a14] p-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#b5ff82]">Judge demo mode</div>
            <p className="mt-1 text-[11px] leading-5 text-[#9ba99f]">
              Load sample Q3 financials with a demo bid and test query access.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleLoadSampleDataset()}
            disabled={isLoadingSample || isPreparingDataset || isExecuting}
            className="shrink-0 border border-[#b5ff82]/35 bg-[#b5ff82]/[0.07] px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#b5ff82] transition hover:border-[#b5ff82]/65 hover:bg-[#b5ff82]/[0.12] disabled:cursor-wait disabled:opacity-55"
          >
            {isLoadingSample || isPreparingDataset ? "Loading sample..." : "Load Sample Dataset"}
          </button>
        </div>

        <div className="border border-white/[0.08] bg-[#090e0f] p-4">
          <div className="mb-3 flex items-center justify-between">
            <label htmlFor="research-query" className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#829088]">
              Ask the private dataset
            </label>
            <span className="font-mono text-[9px] text-[#59665f]">NATURAL LANGUAGE</span>
          </div>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <div className="border border-white/[0.1] bg-[#080c0d] transition focus-within:border-[#72d9d0]/50">
              <div className="flex items-start gap-3 px-4 pt-4">
                <span className="mt-0.5 font-mono text-[12px] text-[#72d9d0]">&gt;_</span>
                <textarea
                  id="research-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="What is the projected revenue for 2026?"
                  className="min-h-[76px] flex-1 resize-y bg-transparent text-[13px] leading-6 text-[#d5ded8] outline-none placeholder:text-[#526059]"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-3">
                <span className="font-mono text-[9px] text-[#64716b]">
                  {query.length} / 500 <span className="mx-2 text-[#3b4741]">|</span> Context: {fileCount ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "none"}
                </span>
                <button
                  type="submit"
                  disabled={!query.trim() || !queryReady || isExecuting || remainingQueries === 0}
                  className="flex h-9 items-center gap-3 bg-[#72d9d0] px-4 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[#071312] transition hover:bg-[#8ce9df] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExecuting ? "Processing in enclave..." : remainingQueries === 0 ? "Query limit reached" : "Run Confidential Query"}
                  <span aria-hidden="true">{isExecuting ? "···" : "↗"}</span>
                </button>
              </div>
            </div>
          </form>

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
            <label className="min-w-0">
              <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.12em] text-[#75827b]">Provider destination</span>
              <input
                value={providerAddress}
                onChange={(event) => onProviderAddressChange(event.target.value)}
                maxLength={128}
                placeholder="provider.near"
                className="h-10 w-full border border-white/[0.1] bg-[#090e0f] px-3 font-mono text-[11px] text-[#cbd5cf] outline-none transition placeholder:text-[#526059] focus:border-[#72d9d0]/50"
              />
            </label>
            <label>
              <span className="mb-2 block font-mono text-[9px] uppercase tracking-[0.12em] text-[#75827b]">Accepted bid · USDC</span>
              <input
                value={acceptedBid ?? ""}
                readOnly
                placeholder="Accept agent bid"
                className="h-10 w-full border border-white/[0.1] bg-[#090e0f] px-3 font-mono text-[11px] text-[#cbd5cf] outline-none placeholder:text-[#526059]"
              />
            </label>
          </div>
        </div>

        <div className="border border-white/[0.08] bg-[#0a0f10] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.13em] text-[#84918a]">TEE execution pipeline</h3>
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[#f0b66a]">
              Mock attestation · mock settlement
            </span>
          </div>
          <ol className="grid gap-2">
            {PIPELINE_STEPS.map((step, index) => {
              const isActive = isExecuting && activeStep === index;
              const isComplete = pipelineComplete
                ? true
                : isExecuting
                  ? activeStep > index
                  : activeStep === PIPELINE_STEPS.length;

              return (
                <li
                  key={step.title}
                  className={`flex items-start gap-3 border px-3 py-3 transition-colors duration-300 ${
                    isActive || isComplete
                      ? "border-[#34d399]/30 bg-[#34d399]/[0.045]"
                      : "border-white/[0.06] bg-white/[0.015]"
                  }`}
                >
                  <span className={`grid size-6 shrink-0 place-items-center border font-mono text-[10px] ${
                    isActive || isComplete
                      ? "border-[#34d399]/40 text-[#74e7b5]"
                      : "border-white/10 text-[#64716b]"
                  }`}>
                    {isComplete ? "✓" : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-[#d5ded8]">{step.title}</span>
                    <span className="mt-1 block text-[10px] leading-4 text-[#78857f]">{step.detail}</span>
                  </span>
                  {isActive && <span className="ml-auto mt-1 size-2 shrink-0 animate-pulse rounded-full bg-[#34d399]" />}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[10px] leading-4 text-[#68756e]">
            Hardware verification and escrow execution shown here are simulated; no hardware proof or NEAR funds are used.
          </p>
        </div>

        {rateLimitAlert && (
          <div role="alert" className="border border-[#f59e0b]/35 bg-[#f59e0b]/[0.08] px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#fbbf24]">⚠️ Probing Attempt Blocked</div>
            <div className="mt-1 text-[11px] leading-5 text-[#fdde9e]">{errorMessage}</div>
          </div>
        )}
        {errorMessage && !rateLimitAlert && (
          <div role="alert" className="border border-[#ff9a83]/25 bg-[#ff9a83]/[0.06] px-4 py-3 font-mono text-[10px] leading-5 text-[#ffad9b]">
            <span className="mr-2 uppercase tracking-[0.1em]">Request failed</span>{errorMessage}
          </div>
        )}

        <div className="overflow-hidden border border-[#34d399]/30 bg-[#0B0F17] shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_0_22px_rgba(16,185,129,0.12)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#34d399]/15 px-4 py-3">
            <div>
              <div className="text-[12px] font-medium text-[#e4eee8]">Insight report</div>
              <div className="mt-1 font-mono text-[9px] text-[#78877c]">
                Run #{String(runCount).padStart(3, "0")} · {attestationToken ? "mock token received" : "awaiting query"}
              </div>
            </div>
            <span className="border border-[#34d399]/25 bg-[#34d399]/[0.06] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[#74e7b5]">
              {insight && antiProbingCheck === "PASSED" ? "Result ready" : isExecuting ? "Executing" : "Secure output"}
            </span>
          </div>
          <div aria-live="polite" className="min-h-24 px-4 py-4 text-[12px] leading-[1.8] text-[#bbc7c0]">
            {isExecuting
              ? "Running query checks and preparing a confidential result..."
              : insight || "Load a dataset and ask a question to see a confidential insight."}
          </div>
          {insight && antiProbingCheck === "PASSED" && (
            <div className="border-t border-[#34d399]/15 bg-[#0d1b16]/80 p-4">
              <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-[#a7f3d0]">
                🔒 Anti-Probing Guard Active
              </div>
              <div className="grid gap-3 text-[10px] sm:grid-cols-3">
                <div className="border border-white/[0.06] px-3 py-2">
                  <span className="block text-[#77847d]">Query entropy score</span>
                  <span className="mt-1 block font-mono text-[#c5f3d9]">{entropyScore} / 100</span>
                </div>
                <div className="border border-white/[0.06] px-3 py-2">
                  <span className="block text-[#77847d]">Queries allowed · this file</span>
                  <span className="mt-1 block font-mono text-[#c5f3d9]">{remainingQueries} / 5 estimated</span>
                </div>
                <div className="border border-white/[0.06] px-3 py-2">
                  <span className="block text-[#77847d]">Noise filter</span>
                  <span className="mt-1 block font-mono text-[#c5f3d9]">ε = 0.5 · demo parameter</span>
                </div>
              </div>
              <p className="mt-3 text-[9px] leading-4 text-[#78877c]">
                Entropy and remaining-query values are UI estimates; server-side anti-probing checks remain authoritative.
                The demo noise parameter is not a formal differential-privacy guarantee.
              </p>
              {transactionHash && (
                <div className="mt-3 border-t border-[#34d399]/10 pt-3">
                  <span className="block font-mono text-[9px] uppercase tracking-[0.1em] text-[#77847d]">
                    Simulated NEAR transaction · no funds moved
                  </span>
                  <a
                    href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all font-mono text-[10px] leading-5 text-[#74e7b5] underline decoration-[#34d399]/30 underline-offset-2 hover:text-[#a7f3d0]"
                  >
                    {transactionHash}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-[#5f6d66]">
          <span>{queryReady ? "Dataset ready for query" : "Load and authorize a dataset to query"}</span>
          <span className="text-[#f0b66a]">MVP simulation · no real TEE claim</span>
        </div>
      </div>
    </section>
  );
}
