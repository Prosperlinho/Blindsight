"use client";

import { useEffect } from "react";

type ConnectModalProps = {
  open: boolean;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onCreateInstantWallet: () => void;
  onConnectExistingWallet: () => void;
};

export default function ConnectModal({
  open,
  isLoading,
  error,
  onClose,
  onCreateInstantWallet,
  onConnectExistingWallet,
}: ConnectModalProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-md sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-modal-title"
        aria-describedby="connect-modal-description"
        className="relative my-auto w-full max-w-[680px] border border-white/10 bg-[#0B0F17] p-5 shadow-[0_24px_100px_rgba(0,0,0,0.65)] sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close wallet connection dialog"
          className="absolute right-4 top-4 grid size-9 place-items-center border border-white/10 text-[#98a49f] transition hover:border-white/25 hover:text-white sm:right-6 sm:top-6"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none">
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>

        <div className="mb-7 pr-10">
          <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#63d9a1]">
            <span className="size-1.5 rounded-full bg-[#34d399] shadow-[0_0_8px_#34d399]" />
            NEAR Protocol
          </div>
          <h2
            id="connect-modal-title"
            className="text-2xl font-medium tracking-[-0.03em] text-[#f1f5f2] sm:text-[30px]"
          >
            Connect your wallet
          </h2>
          <p id="connect-modal-description" className="mt-2 text-sm leading-6 text-[#89958f]">
            Choose how you want to get started with BlindSight.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCreateInstantWallet}
            disabled={isLoading}
            className="group relative flex min-h-[220px] flex-col border border-[#34d399]/40 bg-gradient-to-br from-[#123326]/60 to-[#0d1715] p-5 text-left transition hover:border-[#54edb0]/75 hover:from-[#153c2c]/75 disabled:cursor-wait disabled:opacity-65 sm:p-6"
          >
            <span className="mb-5 inline-flex w-fit items-center gap-1.5 border border-[#34d399]/30 bg-[#34d399]/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-[#74e7b5]">
              <span aria-hidden="true">✦</span>
              Recommended
            </span>
            <span className="text-[17px] font-medium text-white">Create Instant Wallet</span>
            <span className="mt-2 text-xs leading-5 text-[#9ba9a1]">
              Instant Web2 onboarding with a passkey or email.
            </span>
            <span className="mt-5 flex flex-col gap-2 text-xs text-[#c5d2ca]">
              <span className="flex items-center gap-2">
                <span className="text-[#54d99d]">✓</span> No seed phrases to manage
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[#54d99d]">✓</span> Passkey or email onboarding
              </span>
            </span>
            <span className="mt-auto flex items-center gap-2 pt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#74e7b5]">
              {isLoading ? "Opening Meteor Wallet..." : "Get started"}
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
            </span>
          </button>

          <button
            type="button"
            onClick={onConnectExistingWallet}
            disabled={isLoading}
            className="group flex min-h-[220px] flex-col border border-white/10 bg-white/[0.025] p-5 text-left transition hover:border-white/25 hover:bg-white/[0.045] disabled:cursor-wait disabled:opacity-65 sm:p-6"
          >
            <span className="mb-5 grid size-10 place-items-center border border-white/10 bg-white/[0.035] text-[#aebbb4]">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
                <path d="M4 8.5h16v10H4zM7 8.5V6h10v2.5M8 13h3m5 2h.01" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </span>
            <span className="text-[17px] font-medium text-white">Connect Existing Wallet</span>
            <span className="mt-2 text-xs leading-5 text-[#9ba9a1]">
              Use MyNearWallet, Meteor, HOT Wallet, or a hardware key.
            </span>
            <span className="mt-auto flex items-center gap-2 pt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#aebbb4] transition group-hover:text-white">
              Choose a wallet
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
            </span>
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 border border-[#ff9a83]/25 bg-[#ff9a83]/[0.06] px-3 py-2 text-xs leading-5 text-[#ffb5a0]">
            {error}
          </p>
        )}

        <p className="mt-5 text-center font-mono text-[9px] uppercase tracking-[0.1em] text-[#64716b]">
          Wallet access stays in your control
        </p>
      </section>
    </div>
  );
}
