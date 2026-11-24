"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, FileCheck2 } from "lucide-react";

export type AnswerReceiptData = {
  version: 1;
  receiptHash: string;
  issuedAt: string;
  vaultId: string | null;
  rowCount: number | null;
  fieldCount: number | null;
  model: string;
  inputFingerprint: string;
  responseFingerprint: string;
  answerFingerprint: string;
  paymentTxHash: string;
  platformFeeTxHash: string | null;
};

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function parseAnswerReceipt(value: unknown): AnswerReceiptData | null {
  if (typeof value !== "object" || value === null) return null;
  const receipt = value as Partial<AnswerReceiptData>;
  if (receipt.version !== 1
    || !isFingerprint(receipt.receiptHash)
    || typeof receipt.issuedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.issuedAt))
    || !(typeof receipt.vaultId === "string" || receipt.vaultId === null)
    || !(typeof receipt.rowCount === "number" && Number.isInteger(receipt.rowCount) && receipt.rowCount >= 0 || receipt.rowCount === null)
    || !(typeof receipt.fieldCount === "number" && Number.isInteger(receipt.fieldCount) && receipt.fieldCount >= 0 || receipt.fieldCount === null)
    || typeof receipt.model !== "string"
    || !isFingerprint(receipt.inputFingerprint)
    || !isFingerprint(receipt.responseFingerprint)
    || !isFingerprint(receipt.answerFingerprint)
    || typeof receipt.paymentTxHash !== "string"
    || !(typeof receipt.platformFeeTxHash === "string" || receipt.platformFeeTxHash === null)) return null;
  return receipt as AnswerReceiptData;
}

function shorten(value: string, start = 12) {
  return value.length > start * 2 ? `${value.slice(0, start)}…${value.slice(-8)}` : value;
}

function formatCount(value: number | null, singular: string, plural: string) {
  return value === null ? null : `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

export default function AnswerReceipt({ receipt }: { receipt: AnswerReceiptData }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const datasetSize = [
    formatCount(receipt.rowCount, "record", "records"),
    formatCount(receipt.fieldCount, "field", "fields"),
  ].filter(Boolean).join(" · ");

  async function copyReceipt() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(receipt, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <details className="group mt-4 rounded-xl border border-white/10 bg-white/[0.02] text-sm">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <FileCheck2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-cyan-300" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-white">Evidence &amp; answer receipt</span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-400">
            {datasetSize ? `Based on ${datasetSize}. ` : ""}
            Linked to this vault and your NEAR payment.
          </span>
        </span>
        <span className="shrink-0 text-xs text-slate-500 transition group-open:text-slate-300">
          <span className="group-open:hidden">View</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>

      <div className="grid gap-3 border-t border-white/10 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-500">Vault snapshot</span>
          <span className="font-mono text-slate-300">{receipt.vaultId ? shorten(receipt.vaultId) : "Uploaded dataset"}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-500">Model</span>
          <span className="text-slate-300">{receipt.model}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-500">Created</span>
          <time className="text-slate-300" dateTime={receipt.issuedAt}>
            {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(receipt.issuedAt))}
          </time>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate-500">NEAR payments</span>
          <span className="flex flex-wrap gap-x-3">
            {[receipt.paymentTxHash, receipt.platformFeeTxHash].filter((hash): hash is string => Boolean(hash)).map((hash, index) => (
              <a
                key={hash}
                href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(hash)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-8 items-center gap-1 font-mono text-cyan-200 underline decoration-cyan-200/30 underline-offset-2 hover:decoration-cyan-200"
              >
                {index === 0 ? "Vault" : "Platform fee"} · {shorten(hash)}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ))}
          </span>
        </div>

        <details className="rounded-lg border border-white/[0.06] px-3">
          <summary className="min-h-10 cursor-pointer py-3 text-slate-400">Integrity fingerprints</summary>
          <dl className="grid gap-2 border-t border-white/[0.06] py-3">
            <div className="grid gap-1">
              <dt className="text-slate-500">Input</dt>
              <dd className="break-all font-mono text-slate-300">{receipt.inputFingerprint}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-slate-500">Answer</dt>
              <dd className="break-all font-mono text-slate-300">{receipt.answerFingerprint}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="text-slate-500">Receipt</dt>
              <dd className="break-all font-mono text-slate-300">{receipt.receiptHash}</dd>
            </div>
          </dl>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-slate-500">
            {copyState === "copied" ? "Receipt copied." : copyState === "failed" ? "Couldn't copy the receipt." : ""}
          </p>
          <button
            type="button"
            onClick={() => void copyReceipt()}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-slate-200 transition hover:bg-white/[0.06]"
          >
            {copyState === "copied" ? <Check aria-hidden="true" className="size-3.5" /> : <Copy aria-hidden="true" className="size-3.5" />}
            {copyState === "copied" ? "Copied" : "Copy receipt"}
          </button>
        </div>
      </div>
      <p className="border-t border-white/10 px-4 py-3 text-xs leading-5 text-slate-500">
        This receipt connects the answer to its input, vault snapshot, and payment. It records provenance and integrity hashes; it does not prove that the interpretation is correct.
      </p>
    </details>
  );
}
