"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  Coins,
  Database,
  EyeOff,
  FileLock2,
  KeyRound,
  LockKeyhole,
  MessageSquareText,
  Search,
  Sparkles,
  Store,
  Upload,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Reveal, ScrollFade } from "@/components/landing/motion";

type LandingIntroProps = {
  onOpenMarketplace: () => void;
  ctaLabel: string;
  ctaHint: string;
  ctaDisabled: boolean;
};

/** Raised glass surface with a bevelled edge. */
const CARD = "bevel rounded-2xl bg-slate-900/70 transition-colors hover:bg-slate-900";

const PILLARS: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: LockKeyhole,
    title: "Private vaults",
    description: "Datasets stay sealed in their vault. Buyers never see or download the raw files.",
  },
  {
    icon: Coins,
    title: "Paid insights",
    description: "Every question is a small NEAR payment that goes straight to the data owner.",
  },
  {
    icon: KeyRound,
    title: "Data ownership",
    description: "Owners decide what to publish, what each answer costs, and where earnings go.",
  },
];

const HOW_IT_WORKS: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Store, title: "Pick a vault", description: "Browse private datasets listed by their owners." },
  { icon: MessageSquareText, title: "Ask a question", description: "Describe what you want to know in plain language." },
  { icon: Wallet, title: "Pay per question", description: "Confirm the vault's price in your NEAR wallet." },
  { icon: Sparkles, title: "Get the insight", description: "Receive an answer. The source data stays in the vault." },
];

const OWNER_POINTS: { icon: LucideIcon; text: string }[] = [
  { icon: Upload, text: "Publish a dataset as a private vault in minutes." },
  { icon: Coins, text: "Set your own price per question and get paid in NEAR." },
  { icon: LockKeyhole, text: "Raw files are never handed to buyers." },
];

const BUYER_POINTS: { icon: LucideIcon; text: string }[] = [
  { icon: Search, text: "Find vaults by topic, from financials to research cohorts." },
  { icon: MessageSquareText, text: "Ask targeted questions instead of buying whole datasets." },
  { icon: EyeOff, text: "No bulk data to store, secure, or delete later." },
];

const OWNER_DATA_TYPES = ["Financials", "Research cohorts", "Security audits", "Operational data"];

function IconBadge({ icon: Icon, tone = "cyan" }: { icon: LucideIcon; tone?: "cyan" | "emerald" | "violet" }) {
  const tones = {
    cyan: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
    emerald: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    violet: "border-violet-400/25 bg-violet-400/10 text-violet-300",
  };
  return (
    <span className={`grid size-10 shrink-0 place-items-center rounded-xl border shadow-[inset_0_1px_0_rgb(255_255_255/0.08)] ${tones[tone]}`}>
      <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
    </span>
  );
}

function SectionHeading({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <Reveal>
      <p className="text-sm font-medium text-cyan-300">{label}</p>
      <h2
        id={`${id}-title`}
        className="text-3d-soft mt-3 max-w-3xl text-3xl font-semibold leading-[1.1] tracking-[-0.025em] sm:text-4xl"
      >
        {children}
      </h2>
    </Reveal>
  );
}

function OpenMarketplaceButton({
  onOpenMarketplace,
  ctaLabel,
  ctaDisabled,
  className = "",
}: Omit<LandingIntroProps, "ctaHint"> & { className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpenMarketplace}
      disabled={ctaDisabled}
      className={`inline-flex h-12 items-center gap-2 rounded-xl border border-cyan-200/40 bg-cyan-400 px-6 text-sm font-semibold text-slate-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_3px_0_#0E7490,0_12px_28px_-10px_rgb(34_211_238/0.6)] transition hover:bg-cyan-300 active:translate-y-px active:shadow-[inset_0_1px_0_rgb(255_255_255/0.45),0_2px_0_#0E7490] disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      {ctaLabel}
      <ArrowRight aria-hidden="true" className="size-4" />
    </button>
  );
}

/** Illustrative vault card: sealed files in, a paid question, an answer out. */
function VaultIllustration() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-cyan-500/10 via-transparent to-emerald-500/10 blur-2xl" />

      <div className={`${CARD} relative p-5`}>
        <div className="flex items-center gap-3">
          <IconBadge icon={Database} tone="emerald" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Q3 Market Demand</p>
            <p className="text-xs text-slate-400">Private vault · 1,240 rows</p>
          </div>
          <span className="ml-auto rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-200">
            0.15 NEAR
          </span>
        </div>

        <ul className="mt-4 space-y-2">
          {["w-3/4", "w-2/3", "w-4/5"].map((width) => (
            <li key={width} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-slate-950/50 px-3 py-2.5">
              <FileLock2 className="size-4 shrink-0 text-slate-500" strokeWidth={1.75} />
              <span className={`h-2 rounded-full bg-gradient-to-r from-slate-600/70 to-slate-700/30 blur-[1.5px] ${width}`} />
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-3">
          <MessageSquareText className="mt-0.5 size-4 shrink-0 text-slate-400" strokeWidth={1.75} />
          <p className="text-sm text-slate-300">Which region grew fastest last quarter?</p>
        </div>

        <div className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.07] px-3.5 py-3">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-cyan-300" strokeWidth={1.75} />
          <p className="text-sm text-slate-100">The East region, up 18% quarter over quarter, led by repeat enterprise orders.</p>
        </div>
      </div>
    </div>
  );
}

function PointList({ points, tone }: { points: { icon: LucideIcon; text: string }[]; tone: "emerald" | "violet" }) {
  const iconTone = tone === "emerald" ? "text-emerald-300" : "text-violet-300";
  return (
    <ul className="mt-5 space-y-3">
      {points.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-start gap-3 text-sm leading-6 text-slate-300">
          <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${iconTone}`} strokeWidth={1.75} />
          {text}
        </li>
      ))}
    </ul>
  );
}

export default function LandingIntro(props: LandingIntroProps) {
  const { onOpenMarketplace, ctaLabel, ctaDisabled, ctaHint } = props;
  const buttonProps = { onOpenMarketplace, ctaLabel, ctaDisabled };

  return (
    <>
      <section aria-labelledby="hero-title" className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <ScrollFade className="grid items-center gap-10 pb-6 pt-12 sm:pb-8 sm:pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:pt-20">
          <div>
            <Reveal once>
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-1 text-xs font-medium text-emerald-200">
                <Store aria-hidden="true" className="size-3.5" />
                Confidential data marketplace
              </p>
            </Reveal>
            <Reveal once delay={80}>
              <h1
                id="hero-title"
                className="text-3d mt-5 text-4xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-6xl"
              >
                Sell insights from your data. Never the data itself.
              </h1>
            </Reveal>
            <Reveal once delay={160}>
              <p className="mt-5 max-w-xl text-base leading-7 text-slate-400 sm:text-lg sm:leading-8">
                BlindSight is a marketplace of private data vaults. Owners set a price per question, buyers pay in NEAR
                and get an answer, and the source files never leave the vault.
              </p>
            </Reveal>
            <Reveal once delay={240}>
              <OpenMarketplaceButton {...buttonProps} className="mt-7" />
              <p className="mt-3 text-sm text-slate-500">{ctaHint}</p>
            </Reveal>
          </div>

          <Reveal once from="right" delay={200}>
            <VaultIllustration />
          </Reveal>
        </ScrollFade>
      </section>

      <section id="why" aria-labelledby="why-title" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading id="why" label="Why BlindSight">
          A marketplace where the data stays private.
        </SectionHeading>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PILLARS.map((pillar, index) => (
            <Reveal key={pillar.title} delay={index * 100} className="h-full">
              <div className={`${CARD} h-full p-5`}>
                <IconBadge icon={pillar.icon} tone={index === 1 ? "emerald" : index === 2 ? "violet" : "cyan"} />
                <h3 className="mt-4 text-base font-semibold text-white">{pillar.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-400">{pillar.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section
        id="how-it-works"
        aria-labelledby="how-it-works-title"
        className="relative scroll-mt-20 overflow-hidden border-y border-white/10 bg-slate-950/50 py-14 sm:py-20"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-64 w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/[0.06] blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading id="how-it-works" label="How it works">
            From question to insight in four steps.
          </SectionHeading>

          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step.title}>
                <Reveal delay={index * 100} className="h-full">
                  <div className={`${CARD} h-full p-5`}>
                    <div className="flex items-center justify-between">
                      <IconBadge icon={step.icon} />
                      <span className="text-3d-soft text-2xl font-bold text-slate-200/90">{index + 1}</span>
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-white">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-slate-400">{step.description}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-label="Owners and buyers" className="mx-auto grid max-w-6xl gap-4 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2">
        <Reveal from="left" className="h-full">
          <article id="data-owners" aria-labelledby="data-owners-title" className={`${CARD} h-full scroll-mt-24 p-6 sm:p-7`}>
            <div className="flex items-center gap-3">
              <IconBadge icon={KeyRound} tone="emerald" />
              <p className="text-sm font-medium text-emerald-300">For data owners</p>
            </div>
            <h2 id="data-owners-title" className="text-3d-soft mt-5 text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
              Earn from your data without giving it away.
            </h2>
            <PointList points={OWNER_POINTS} tone="emerald" />
            <ul className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-5">
              {OWNER_DATA_TYPES.map((type) => (
                <li key={type} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
                  {type}
                </li>
              ))}
            </ul>
          </article>
        </Reveal>

        <Reveal from="right" delay={120} className="h-full">
          <article id="buyers-agents" aria-labelledby="buyers-agents-title" className={`${CARD} h-full scroll-mt-24 p-6 sm:p-7`}>
            <div className="flex items-center gap-3">
              <IconBadge icon={Search} tone="violet" />
              <p className="text-sm font-medium text-violet-300">For buyers</p>
            </div>
            <h2 id="buyers-agents-title" className="text-3d-soft mt-5 text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-3xl">
              Pay for the answer, not the whole dataset.
            </h2>
            <PointList points={BUYER_POINTS} tone="violet" />
          </article>
        </Reveal>
      </section>

      <section aria-labelledby="cta-title" className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6 sm:pb-24">
        <Reveal>
          <div className={`${CARD} relative overflow-hidden px-6 py-12 text-center sm:py-16`}>
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />
            <h2
              id="cta-title"
              className="text-3d mx-auto max-w-3xl text-3xl font-bold leading-tight tracking-[-0.03em] sm:text-5xl"
            >
              Your data. Your price. Your vault.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-slate-400 sm:text-base">
              Browse private vaults or publish your own in the BlindSight marketplace.
            </p>
            <OpenMarketplaceButton {...buttonProps} className="mt-8" />
            <p className="mt-3 text-xs text-slate-500">{ctaHint}</p>
          </div>
        </Reveal>
      </section>
    </>
  );
}
