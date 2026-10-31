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
  onDismissError: () => void;
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
  onDismissError,
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
    <section className="flex min-w-0 flex-col border border-[#39463d] bg-[#18221c]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#39463d] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="size-2 rotate-45 border border-[#9dae8c]" />
          <h2 className="text-[14px] font-medium">Ask your data</h2>
        </div>
        <span className="flex items-center gap-2 text-[10px] text-[#a4afa0]">
          <span className="size-1.5 rounded-full bg-[#9dae8c]" />
          Query preview
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[#39463d] bg-[#111914] px-4 py-3">
          <div>
            <div className="text-[11px] text-[#a4afa0]">Demo query balance</div>
            <div className="mt-1 font-mono text-[16px] font-semibold text-[#e5e8dc]">{buyerBalance} <span className="text-[12px] font-normal text-[#a4afa0]">USDC</span></div>
          </div>
          <button
            type="button"
            onClick={onDeposit}
            disabled={isDepositing || buyerBalance >= 50}
            className="flex h-9 items-center justify-center gap-2 border border-[#526052] px-3 text-[11px] text-[#d3d9cd] transition hover:border-[#9dae8c] hover:bg-[#1d2921] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDepositing ? "Funding agent..." : buyerBalance >= 50 ? "Agent funded" : "Deposit 50 USDC to Agent"}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-[#c9f27a]/70 bg-[#1d2921] px-4 py-3">
          <div>
            <div className="text-[12px] font-medium text-[#e5e8dc]">Try a sample dataset</div>
            <p className="mt-1 text-[11px] leading-5 text-[#a4afa0]">
              Explore the query flow with sample Q3 financials.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleLoadSampleDataset()}
            disabled={isLoadingSample || isPreparingDataset || isExecuting}
            className="shrink-0 bg-[#c9f27a] px-3 py-2 text-[11px] font-semibold text-[#182018] transition hover:bg-[#d9f995] disabled:cursor-wait disabled:opacity-55"
          >
            {isLoadingSample || isPreparingDataset ? "Loading sample..." : "Load Sample Dataset"}
          </button>
        </div>

        <div className="border border-[#39463d] bg-[#111914] p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <label htmlFor="research-query" className="text-[12px] font-medium text-[#d3d9cd]">
              Ask the private dataset
            </label>
            <span className="text-[10px] text-[#839080]">Up to 500 characters</span>
          </div>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <div className="border border-[#526052] bg-[#151e19] transition-colors focus-within:border-[#c9f27a]/70">
              <div className="flex items-start gap-3 px-4 pt-4">
                <span className="mt-0.5 text-[14px] text-[#9dae8c]" aria-hidden="true">“</span>
                <textarea
                  id="research-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="What is the projected revenue for 2026?"
                  className="min-h-[92px] flex-1 resize-y bg-transparent text-[14px] leading-6 text-[#e5e8dc] outline-none placeholder:text-[#839080]"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#39463d] px-4 py-3">
                <span className="text-[10px] text-[#a4afa0]">
                  {query.length} / 500 <span className="mx-2 text-[#526052]">·</span> {fileCount ? `${fileCount} file${fileCount === 1 ? "" : "s"} attached` : "No files attached"}
                </span>
                <button
                  type="submit"
                  disabled={!query.trim() || !queryReady || isExecuting || remainingQueries === 0}
                  className="flex h-10 items-center gap-3 bg-[#c9f27a] px-4 text-[11px] font-semibold text-[#182018] transition hover:bg-[#d9f995] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isExecuting ? "Processing in enclave..." : remainingQueries === 0 ? "Query limit reached" : "Run Confidential Query"}
                  <span aria-hidden="true">{isExecuting ? "···" : "→"}</span>
                </button>
              </div>
            </div>
          </form>

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px]">
            <label className="min-w-0">
              <span className="mb-2 block text-[11px] text-[#a4afa0]">Provider destination</span>
              <input
                value={providerAddress}
                onChange={(event) => onProviderAddressChange(event.target.value)}
                maxLength={128}
                placeholder="provider.near"
                className="h-10 w-full border border-[#39463d] bg-[#151e19] px-3 text-[12px] text-[#d3d9cd] outline-none transition placeholder:text-[#839080] focus:border-[#c9f27a]/60"
              />
            </label>
            <label>
              <span className="mb-2 block text-[11px] text-[#a4afa0]">Accepted bid · USDC</span>
              <input
                value={acceptedBid ?? ""}
                readOnly
                placeholder="Accept agent bid"
                className="h-10 w-full border border-[#39463d] bg-[#151e19] px-3 text-[12px] text-[#d3d9cd] outline-none placeholder:text-[#839080]"
              />
            </label>
          </div>
        </div>

        <div className="border border-[#39463d] bg-[#151e19] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[12px] font-medium text-[#d3d9cd]">What happens to a query</h3>
            <span className="text-[10px] text-[#a4afa0]">
              Simulated workflow
            </span>
          </div>
          <ol className="grid gap-0 sm:grid-cols-2">
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
                  className={`flex items-start gap-3 border-b border-[#39463d] px-3 py-3 transition-colors duration-300 sm:even:border-l ${
                    isActive || isComplete
                      ? "bg-[#c9f27a]/[0.035]"
                      : "bg-transparent"
                  }`}
                >
                  <span className={`grid size-6 shrink-0 place-items-center border font-mono text-[10px] ${
                    isActive || isComplete
                      ? "border-[#9dae8c] text-[#c9f27a]"
                      : "border-[#526052] text-[#839080]"
                  }`}>
                    {isComplete ? "✓" : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[#d3d9cd]">{step.title}</span>
                    <span className="mt-1 block text-[10px] leading-4 text-[#a4afa0]">{step.detail}</span>
                  </span>
                  {isActive && <span className="ml-auto mt-1 size-2 shrink-0 animate-pulse rounded-full bg-[#c9f27a]" />}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[10px] leading-4 text-[#839080]">
            No hardware proof or NEAR funds are used in this prototype.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className={`fixed right-5 top-20 z-40 flex w-[min(440px,calc(100vw-40px))] items-start justify-between gap-4 border px-4 py-3 text-[12px] leading-5 shadow-2xl shadow-black/40 ${
              rateLimitAlert
                ? "border-[#9d7356]/60 bg-[#34261d] text-[#f0c99a]"
                : "border-[#9e6d60]/50 bg-[#2b211e] text-[#e3b2a1]"
            }`}
          >
            <span>
              <span className="font-medium">{rateLimitAlert ? "Query blocked." : "Request failed."}</span>
              <span className="ml-1">{errorMessage}</span>
            </span>
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss error message"
              className="shrink-0 text-base leading-none opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </div>
        )}

        <div className="overflow-hidden border border-[#526052] bg-[#111914]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#39463d] px-4 py-3">
            <div>
              <div className="text-[13px] font-medium text-[#e5e8dc]">Answer</div>
              <div className="mt-1 text-[10px] text-[#a4afa0]">
                Query {runCount ? `#${runCount}` : "not run"} · {attestationToken ? "demo token received" : "waiting for a question"}
              </div>
            </div>
            <span className="border border-[#526052] px-2 py-1 text-[10px] text-[#b7c0b1]">
              {insight && antiProbingCheck === "PASSED" ? "Result ready" : isExecuting ? "Executing" : "Answer preview"}
            </span>
          </div>
          <div aria-live="polite" className="min-h-24 px-4 py-5 text-[14px] leading-7 text-[#d3d9cd]">
            {isExecuting
              ? "Running query checks and preparing a confidential result..."
              : insight || "Load a dataset and ask a question to see a confidential insight."}
          </div>
          {insight && antiProbingCheck === "PASSED" && (
            <div className="border-t border-[#39463d] bg-[#18221c] p-4">
              <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-[#c9f27a]">
                <span aria-hidden="true">⌑</span>
                Anti-probing checks passed
              </div>
              <div className="grid gap-3 text-[10px] sm:grid-cols-3">
                <div className="border border-[#39463d] px-3 py-2">
                  <span className="block text-[#a4afa0]">Query entropy estimate</span>
                  <span className="mt-1 block font-mono text-[#e5e8dc]">{entropyScore} / 100</span>
                </div>
                <div className="border border-[#39463d] px-3 py-2">
                  <span className="block text-[#a4afa0]">Estimated queries left</span>
                  <span className="mt-1 block font-mono text-[#e5e8dc]">{remainingQueries} / 5</span>
                </div>
                <div className="border border-[#39463d] px-3 py-2">
                  <span className="block text-[#a4afa0]">Noise parameter</span>
                  <span className="mt-1 block font-mono text-[#e5e8dc]">ε = 0.5 · demo only</span>
                </div>
              </div>
              <p className="mt-3 text-[10px] leading-4 text-[#a4afa0]">
                Entropy and remaining-query values are UI estimates; server-side anti-probing checks remain authoritative.
                The demo noise parameter is not a formal differential-privacy guarantee.
              </p>
              {transactionHash && (
                <div className="mt-3 border-t border-[#39463d] pt-3">
                  <span className="block text-[10px] text-[#a4afa0]">
                    Simulated NEAR transaction · no funds moved
                  </span>
                  <a
                    href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all font-mono text-[11px] leading-5 text-[#c9f27a] underline decoration-[#9dae8c]/50 underline-offset-2 hover:text-[#e5e8dc]"
                  >
                    {transactionHash}
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#839080]">
          <span>{queryReady ? "Dataset ready for a question" : "Add a dataset and authorize a query to continue"}</span>
          <span>Simulation · no hardware attestation</span>
        </div>
      </div>
    </section>
  );
}
