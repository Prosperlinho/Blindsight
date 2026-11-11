"use client";

import { ShieldCheck, ShieldHalf } from "lucide-react";
import type { PrivacyReceipt as PrivacyReceiptData } from "@/lib/privateInference";

export type { PrivacyReceiptData };

/** Narrows an untrusted API value to a receipt, or null. */
export function parsePrivacyReceipt(value: unknown): PrivacyReceiptData | null {
  if (typeof value !== "object" || value === null) return null;
  const receipt = value as Partial<PrivacyReceiptData>;
  if (typeof receipt.attested !== "boolean"
    || typeof receipt.encryptedToEnclave !== "boolean"
    || typeof receipt.responseSigned !== "boolean"
    || typeof receipt.model !== "string") return null;
  return receipt as PrivacyReceiptData;
}

const MODEL_NAMES: Record<string, string> = {
  "deepseek/deepseek-v3.2": "DeepSeek V3.2",
};

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function shorten(value: string | null, size = 10) {
  if (!value) return "—";
  return value.length > size * 2 ? `${value.slice(0, size)}…${value.slice(-6)}` : value;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-slate-300">{children}</dd>
    </div>
  );
}

export default function PrivacyReceipt({ receipt }: { receipt: PrivacyReceiptData }) {
  const fullyVerified = receipt.attested && receipt.encryptedToEnclave && receipt.responseSigned;
  if (!receipt.attested) return null;

  const Icon = fullyVerified ? ShieldCheck : ShieldHalf;
  const modelName = MODEL_NAMES[receipt.model] ?? receipt.model;
  const summary = fullyVerified
    ? "Your question was encrypted to a hardware-secured enclave, and the enclave signed this answer."
    : receipt.encryptedToEnclave
      ? "Your question was encrypted to a verified hardware-secured enclave."
      : "This answer came from a verified hardware-secured enclave.";

  return (
    <details className="group mt-6 rounded-xl border border-white/10 bg-white/[0.02] text-sm">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${fullyVerified ? "text-emerald-300" : "text-cyan-300"}`} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-white">
            {fullyVerified ? "Verified private answer" : "Private processing"}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-400">{summary}</span>
        </span>
        <span className="shrink-0 text-xs text-slate-500 transition group-open:text-slate-300">
          <span className="group-open:hidden">Details</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>

      <dl className="grid gap-2 border-t border-white/10 px-4 py-3 text-xs">
        <Row label="Enclave check">
          Intel TDX {receipt.gatewayTcbStatus === "UpToDate" ? "up to date" : receipt.gatewayTcbStatus ?? "verified"}
          {receipt.attestedAt && <>, verified at {timeFormatter.format(new Date(receipt.attestedAt))}</>}
        </Row>
        <Row label="Model">
          {modelName}
          {receipt.provider && <> on {receipt.provider}</>}
          {receipt.modelNonceBound ? " · enclave verified" : " · enclave reported"}
          {receipt.gpuVerdict && <> · GPU {receipt.gpuVerdict === "PASS" ? "passed" : receipt.gpuVerdict}</>}
        </Row>
        <Row label="Question encrypted">{receipt.encryptedToEnclave ? "Yes, to the enclave's attested key" : "No, sent over standard HTTPS"}</Row>
        <Row label="Answer signed">
          {receipt.responseSigned ? <>Yes, by enclave key <span className="font-mono">{shorten(receipt.signer)}</span></> : "Not confirmed"}
        </Row>
        <Row label="Question fingerprint"><span className="font-mono">{shorten(receipt.requestHash, 12)}</span></Row>
        <Row label="Answer fingerprint"><span className="font-mono">{shorten(receipt.responseHash, 12)}</span></Row>
        <Row label="Freshness proof"><span className="font-mono">{shorten(receipt.attestationNonce, 12)}</span></Row>
      </dl>
      <p className="border-t border-white/10 px-4 py-3 text-xs leading-5 text-slate-500">
        BlindSight checked the enclave&apos;s Intel attestation with a one-time code, sent your question encrypted to
        it, and confirmed the enclave&apos;s signature over this exact question and answer. The vault data is
        decrypted on BlindSight&apos;s server to build the question, which isn&apos;t enclave-protected yet.
      </p>
    </details>
  );
}
