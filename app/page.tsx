"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import LandingIntro from "@/components/LandingIntro";
import SiteFooter from "@/components/SiteFooter";
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
  { href: "#why", label: "Why BlindSight" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#data-owners", label: "Owners" },
  { href: "#buyers-agents", label: "Buyers" },
];

// Show the back-to-top button once the visitor is this close to the bottom.
const BACK_TO_TOP_THRESHOLD_PX = 600;

function scrollToTop() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

export default function LandingPage() {
  const router = useRouter();
  const { accountId, isReady, error: walletContextError, signIn } = useWallet();
  const [isAwaitingWallet, setIsAwaitingWallet] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    router.prefetch(MARKETPLACE_PATH);
  }, [router]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const { scrollHeight } = document.documentElement;
      const distanceToBottom = scrollHeight - (window.scrollY + window.innerHeight);
      setShowBackToTop(window.scrollY > window.innerHeight * 0.5 && distanceToBottom < BACK_TO_TOP_THRESHOLD_PX);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

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
    // overflow-x-clip (not hidden) so this wrapper doesn't become a scroll
    // container, which would stop the sticky header from sticking.
    <div className="relative min-h-screen overflow-x-clip text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0B1120]/80 shadow-[0_1px_0_rgb(255_255_255/0.03),0_8px_24px_-12px_rgb(0_0_0/0.6)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <a href="#top" className="flex items-center gap-2" aria-label="BlindSight home">
            <Image src="/logo-mark.png" alt="" width={32} height={32} className="size-8 object-contain" priority />
            <span className="text-sm font-semibold tracking-[0.08em] text-white">BlindSight</span>
          </a>

          <nav aria-label="Page sections" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1 text-xs text-slate-400">
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

          <button
            type="button"
            onClick={() => void handleOpenMarketplace()}
            disabled={!isReady}
            className="ml-auto inline-flex min-h-9 items-center rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-wait disabled:opacity-60 md:ml-2"
          >
            Open Marketplace
          </button>
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

      <SiteFooter />

      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Back to top"
        tabIndex={showBackToTop ? 0 : -1}
        aria-hidden={!showBackToTop}
        className={`bevel fixed bottom-5 right-5 z-40 grid size-11 place-items-center rounded-full bg-slate-900/90 text-slate-200 backdrop-blur-xl transition duration-300 hover:bg-slate-800 hover:text-white ${
          showBackToTop ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        <ArrowUp aria-hidden="true" className="size-5" />
      </button>

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
