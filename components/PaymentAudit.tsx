"use client";

import type { AuditLogEntry } from "@/lib/auditLog";
import {
  NEAR_TESTNET_RPC_URL,
  getTransactionExplorerUrl,
  getTreasuryExplorerUrl,
} from "@/lib/paymentConfig";

type PaymentAuditProps = {
  nearAccountId: string | null;
  treasuryAccount: string;
  auditLog: AuditLogEntry[];
};

export default function PaymentAudit({
  nearAccountId,
  treasuryAccount,
  auditLog,
}: PaymentAuditProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-slate-950/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="text-[13px]">◎</span>
          <span className="min-w-0">
            <span className="block text-[12px] font-medium text-white">
              Settlement &amp; verification
            </span>
            <span className="mt-0.5 block text-[10px] text-slate-500">
              On-chain payment evidence only — no local balances or invented proofs
            </span>
          </span>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2.5 py-1 text-[10px] text-cyan-200">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-cyan-400 animate-pulse-glow" />
          NEAR testnet · real
        </span>
      </div>

      <div className="p-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <section
            aria-labelledby="settlement-rail-title"
            className="rounded-lg border border-white/10 bg-slate-900/40 p-3"
          >
            <h3 id="settlement-rail-title" className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
              Settlement rail
            </h3>
            <dl className="mt-3 grid gap-2 text-[10px]">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Network</dt>
                <dd className="text-slate-100">NEAR testnet</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Asset</dt>
                <dd className="text-slate-100">Native NEAR</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Wallet</dt>
                <dd className="break-all text-right font-mono text-slate-100">
                  {nearAccountId ?? "Not connected"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Treasury</dt>
                <dd className="break-all text-right">
                  <a
                    href={getTreasuryExplorerUrl(treasuryAccount)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-cyan-200 underline underline-offset-2 hover:text-white"
                  >
                    {treasuryAccount} ↗
                  </a>
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-slate-500">Verification RPC</dt>
                <dd className="break-all text-right font-mono text-slate-100">
                  {NEAR_TESTNET_RPC_URL.replace(/^https?:\/\//, "")}
                </dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="verification-policy-title"
            className="rounded-lg border border-white/10 bg-slate-900/40 p-3"
          >
            <h3 id="verification-policy-title" className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
              Server verification policy
            </h3>
            <ul className="mt-3 space-y-1.5 text-[10px] leading-4 text-slate-400">
              <li>✓ Transaction is finalized successfully on NEAR testnet.</li>
              <li>✓ Signer matches the connected payer account.</li>
              <li>✓ Receiver is the BlindSight treasury account.</li>
              <li>✓ Native NEAR deposit covers the listed query price.</li>
              <li>✓ Payment is younger than two hours.</li>
              <li>
                <span className="text-amber-300">!</span> Replay protection is an in-memory,
                per-instance guard. It is best-effort, not a network-wide nonce.
              </li>
            </ul>
          </section>
        </div>

        <section
          aria-labelledby="payment-audit-title"
          className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-slate-900/40"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
            <h3 id="payment-audit-title" className="text-[10px] uppercase tracking-[0.14em] text-slate-400">
              Client audit log
            </h3>
            <span className="rounded-md border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200">
              {auditLog.length}
            </span>
          </div>
          {auditLog.length === 0 ? (
            <p className="px-3 py-3 text-[10px] leading-5 text-slate-500">
              No activity yet. Signed payments, verified transactions, and vault changes are recorded
              here.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {auditLog.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 text-[11px] leading-5 text-slate-100">
                    {entry.message}
                    {entry.txHash && (
                      <a
                        href={getTransactionExplorerUrl(entry.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 block break-all font-mono text-[10px] text-cyan-300 underline underline-offset-2 hover:text-cyan-100"
                      >
                        Tx {entry.txHash} ↗
                      </a>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">
                    {entry.timestamp}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
