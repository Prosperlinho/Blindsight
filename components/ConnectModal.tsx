"use client";

import { useEffect, useState, type FormEvent } from "react";

type ConnectModalProps = {
  open: boolean;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onCreateInstantWallet: () => void;
  onImportPrivateKey: (secretKey: string) => void;
  onConnectExistingWallet: () => void;
};

export default function ConnectModal(props: ConnectModalProps) {
  if (!props.open) return null;

  return <ConnectModalDialog {...props} />;
}

function ConnectModalDialog({
  isLoading,
  error,
  onClose,
  onCreateInstantWallet,
  onImportPrivateKey,
  onConnectExistingWallet,
}: ConnectModalProps) {
  const [isImportFormOpen, setIsImportFormOpen] = useState(false);
  const [secretKey, setSecretKey] = useState("");

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

  function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onImportPrivateKey(secretKey);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#090e0b]/80 p-4 backdrop-blur-md sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-modal-title"
        aria-describedby="connect-modal-description"
        className="relative my-auto w-full max-w-[680px] border border-[#526052] bg-[#18221c] p-5 shadow-[0_24px_100px_rgba(0,0,0,0.65)] sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close wallet connection dialog"
          className="absolute right-4 top-4 grid size-9 place-items-center border border-[#39463d] text-[#a4afa0] transition hover:border-[#9dae8c] hover:text-[#e5e8dc] sm:right-6 sm:top-6"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none">
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>

        <div className="mb-7 pr-10">
          <div className="mb-3 flex items-center gap-2 text-[11px] text-[#a4afa0]">
            <span className="size-1.5 rounded-full bg-[#c9f27a]" />
            NEAR Protocol
          </div>
          <h2
            id="connect-modal-title"
            className="font-serif text-2xl font-medium tracking-[-0.03em] text-[#e5e8dc] sm:text-[30px]"
          >
            Connect your wallet
          </h2>
          <p id="connect-modal-description" className="mt-2 text-sm leading-6 text-[#a4afa0]">
            Choose how you want to get started with BlindSight.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-h-[220px] flex-col border border-[#9dae8c]/55 bg-[#1d2921] p-5 transition-colors hover:border-[#c9f27a]/70 sm:p-6">
            <button
              type="button"
              onClick={onCreateInstantWallet}
              disabled={isLoading}
              className="group flex flex-1 flex-col text-left disabled:cursor-wait disabled:opacity-65"
            >
              <span className="mb-5 inline-flex w-fit items-center gap-1.5 border border-[#9dae8c]/45 bg-[#9dae8c]/[0.08] px-2 py-1 text-[10px] text-[#c9f27a]">
                <span aria-hidden="true">✦</span>
                Recommended
              </span>
              <span className="text-[17px] font-medium text-[#e5e8dc]">Create Instant Wallet</span>
              <span className="mt-2 text-xs leading-5 text-[#a4afa0]">
                Create a wallet in this browser without an external redirect.
              </span>
              <span className="mt-5 flex flex-col gap-2 text-xs text-[#d3d9cd]">
                <span className="flex items-center gap-2">
                  <span className="text-[#c9f27a]">✓</span> No seed phrase setup
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-[#c9f27a]">✓</span> Ready instantly in this browser
                </span>
              </span>
              <span className="mt-auto flex items-center gap-2 pt-5 text-[11px] text-[#c9f27a]">
                {isLoading ? "Creating wallet..." : "Get started"}
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsImportFormOpen((isOpen) => !isOpen)}
              className="mt-4 w-fit text-left text-xs text-[#a4afa0] underline decoration-[#526052] underline-offset-4 transition hover:text-[#c9f27a]"
            >
              Already have an embedded key? Import Key
            </button>
          </div>

          <button
            type="button"
            onClick={onConnectExistingWallet}
            disabled={isLoading}
            className="group flex min-h-[220px] flex-col border border-[#39463d] bg-[#151e19] p-5 text-left transition hover:border-[#9dae8c]/70 hover:bg-[#1d2921] disabled:cursor-wait disabled:opacity-65 sm:p-6"
          >
            <span className="mb-5 grid size-10 place-items-center border border-[#39463d] bg-[#18221c] text-[#a4afa0]">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
                <path d="M4 8.5h16v10H4zM7 8.5V6h10v2.5M8 13h3m5 2h.01" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </span>
            <span className="text-[17px] font-medium text-[#e5e8dc]">Connect Existing Wallet</span>
            <span className="mt-2 text-xs leading-5 text-[#a4afa0]">
              Use MyNearWallet, Meteor, HOT Wallet, or a hardware key.
            </span>
            <span className="mt-auto flex items-center gap-2 pt-5 text-[11px] text-[#b7c0b1] transition group-hover:text-[#e5e8dc]">
              Choose a wallet
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
            </span>
          </button>
        </div>

        {isImportFormOpen && (
          <form onSubmit={handleImport} className="mt-4 border border-[#39463d] bg-[#151e19] p-4">
            <label htmlFor="embedded-private-key" className="block text-xs font-medium text-[#d3d9cd]">
              Import your embedded wallet key
            </label>
            <input
              id="embedded-private-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secretKey}
              onChange={(event) => setSecretKey(event.target.value)}
              placeholder="ed25519:..."
              disabled={isLoading}
              required
              className="mt-2 w-full border border-[#39463d] bg-[#111914] px-3 py-2.5 font-mono text-xs text-[#e5e8dc] outline-none placeholder:text-[#839080] focus:border-[#c9f27a]/60 disabled:opacity-60"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[10px] leading-4 text-[#a4afa0]">
                The key is imported into this browser&apos;s local storage.
              </p>
              <button
                type="submit"
                disabled={isLoading || !secretKey.trim()}
                className="shrink-0 bg-[#c9f27a] px-3 py-2 text-[11px] font-medium text-[#182018] transition hover:bg-[#d9f995] disabled:cursor-wait disabled:opacity-50"
              >
                {isLoading ? "Importing..." : "Import wallet"}
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 border border-[#9e6d60]/50 bg-[#2b211e] px-3 py-2 text-xs leading-5 text-[#e3b2a1]">
            {error}
          </p>
        )}

        <p className="mt-5 text-center text-[10px] text-[#a4afa0]">
          Embedded wallet keys are stored in this browser&apos;s local storage
        </p>
      </section>
    </div>
  );
}
