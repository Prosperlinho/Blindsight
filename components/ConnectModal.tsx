"use client";

import { useEffect } from "react";

type ConnectModalProps = {
  open: boolean;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onConnect: () => void;
};

export default function ConnectModal(props: ConnectModalProps) {
  if (!props.open) return null;

  return <ConnectModalDialog {...props} />;
}

function ConnectModalDialog({ isLoading, error, onClose, onConnect }: ConnectModalProps) {
  useEffect(() => {
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
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#020617]/80 p-4 backdrop-blur-md sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-modal-title"
        aria-describedby="connect-modal-description"
        className="relative my-auto w-full max-w-[560px] border border-emerald-500/20 bg-[#0B0F17]/80 p-5 shadow-[0_0_20px_rgba(16,185,129,0.15)] backdrop-blur-xl sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close wallet connection dialog"
          className="absolute right-4 top-4 grid size-9 place-items-center border border-emerald-500/20 text-[#A7B9B0] transition hover:border-[#34D399] hover:text-[#F0FDF4] sm:right-6 sm:top-6"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none">
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>

        <div className="mb-7 pr-10">
          <h2
            id="connect-modal-title"
            className="font-serif text-2xl font-medium tracking-[-0.03em] text-[#F0FDF4] sm:text-[30px]"
          >
            Connect your wallet
          </h2>
          <p id="connect-modal-description" className="mt-2 text-sm leading-6 text-[#A7B9B0]">
            Connect your wallet to browse vaults and ask a question.
          </p>
        </div>

        <button
          type="button"
          onClick={onConnect}
          disabled={isLoading}
          className="group flex w-full flex-col border border-emerald-500/40 bg-[#0B0F17]/80 p-5 text-left backdrop-blur-xl transition hover:border-emerald-400/60 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:cursor-wait disabled:opacity-65 sm:p-6"
        >
          <span className="text-[17px] font-medium text-[#F0FDF4]">Connect a NEAR wallet</span>
          <span className="mt-2 text-xs leading-5 text-[#A7B9B0]">
            MyNearWallet, Meteor, or another supported NEAR wallet.
          </span>
          <span className="mt-auto flex items-center gap-2 pt-5 text-[11px] text-[#10B981]">
            {isLoading ? "Connecting..." : "Continue to wallet"}
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
          </span>
        </button>

        {error && (
          <p role="alert" className="mt-4 border border-[#7F1D1D]/50 bg-[#261719] px-3 py-2 text-xs leading-5 text-[#FCA5A5]">
            {error}
          </p>
        )}

      </section>
    </div>
  );
}
