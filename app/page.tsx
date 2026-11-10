"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import LandingIntro from "@/components/LandingIntro";
import { useWallet } from "@/components/WalletProvider";

const MARKETPLACE_PATH = "/marketplace";
// Remembers that the visitor clicked "Open Marketplace" so the redirect still
// happens after a wallet that signs in via a full-page redirect returns here.
const OPEN_INTENT_KEY = "blindsight:open-marketplace-intent";

function readIntent(): boolean {
  try {
    return window.sessionStorage.getItem(OPEN_INTENT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeIntent(active: boolean) {
  try {
    if (active) window.sessionStorage.setItem(OPEN_INTENT_KEY, "1");
    else window.sessionStorage.removeItem(OPEN_INTENT_KEY);
  } catch {
    // Storage can be unavailable (private mode); the in-memory flag still works.
  }
}

const NAV_LINKS = [
  { href: "#problem", label: "Problem" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#data-owners", label: "Owners" },
  { href: "#buyers-agents", label: "Buyers" },
];

export default function LandingPage() {
  const router = useRouter();
  const { accountId, isReady, error: walletContextError, signIn } = useWallet();
  const [isAwaitingWallet, setIsAwaitingWallet] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    router.prefetch(MARKETPLACE_PATH);
  }, [router]);

  // Enter the marketplace only once a wallet connection has actually landed.
  useEffect(() => {
    if (!accountId) return;
    if (isAwaitingWallet || readIntent()) {
      writeIntent(false);
      router.push(MARKETPLACE_PATH);
    }
  }, [accountId, isAwaitingWallet, router]);

  async function handleOpenMarketplace() {
    setConnectError(null);

    if (accountId) {
      router.push(MARKETPLACE_PATH);
      return;
    }

    writeIntent(true);
    setIsAwaitingWallet(true);
    try {
      await signIn();
    } catch {
      writeIntent(false);
      setIsAwaitingWallet(false);
      setConnectError(
        "Couldn't open your wallet. Please try again.",
      );
    }
  }

  const activeError = connectError ?? walletContextError;
  const ctaHint = !isReady
    ? "Getting your wallet ready…"
    : accountId
      ? "Wallet connected. You're ready to continue."
      : isAwaitingWallet
        ? "Finish connecting in the wallet window to continue."
        : "Connect a wallet to continue.";

  return (
    <div className="relative min-h-screen overflow-x-hidden text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <a href="#top" className="flex items-center gap-2.5" aria-label="BlindSight home">
            <span className="grid size-9 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 shadow-[0_0_25px_rgba(56,189,248,0.15)]">
              <Image
                src="/logo.png"
                alt=""
                width={26}
                height={26}
                className="h-6 w-6 object-contain"
                priority
              />
            </span>
            <span className="text-sm font-semibold tracking-[0.08em] text-white">BlindSight</span>
          </a>

          <nav aria-label="Page sections" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1 text-[11px] text-slate-400">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="rounded-full px-3 py-1.5 transition hover:bg-white/5 hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="top" className="scroll-mt-20">
        <LandingIntro
          onOpenMarketplace={() => void handleOpenMarketplace()}
          ctaLabel="Open Marketplace"
          ctaHint={ctaHint}
          ctaDisabled={!isReady}
        />
      </main>

      <footer className="mx-auto flex w-full max-w-6xl border-t border-white/10 px-4 py-6 text-[10px] text-slate-500 sm:px-6">
        <span>BlindSight · Insights from private data</span>
      </footer>

      {activeError && (
        <div
          role="alert"
          className="fixed bottom-5 left-5 z-50 flex max-w-[min(420px,calc(100vw-40px))] items-start gap-4 rounded-xl border border-rose-400/30 bg-slate-950/95 px-4 py-3 text-xs leading-5 text-rose-200 shadow-2xl shadow-rose-950/40 backdrop-blur-xl"
        >
          <span>{activeError}</span>
          {connectError && (
            <button
              type="button"
              onClick={() => setConnectError(null)}
              aria-label="Dismiss wallet error"
              className="text-sm text-rose-300/70 hover:text-rose-100"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
