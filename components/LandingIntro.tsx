"use client";

import type { ReactNode } from "react";
import { Reveal, ScrollFade } from "@/components/landing/motion";

type LandingIntroProps = {
  onOpenMarketplace: () => void;
  ctaLabel: string;
  ctaHint: string;
  ctaDisabled: boolean;
};

/** Shared "lifted" surface: glass card raised off the background. */
const LIFT =
  "rounded-2xl border border-white/10 bg-slate-900/70 transition-colors " +
  "hover:border-white/20 hover:bg-slate-900";

const HOW_IT_WORKS = [
  { title: "Choose a vault", description: "Browse the data available to you." },
  { title: "Ask a question", description: "Tell us what you want to understand." },
  { title: "Pay with NEAR", description: "Confirm the price in your wallet." },
  { title: "Get an answer", description: "Receive an insight without downloading the source files." },
];

const OWNER_DATA_TYPES = ["Financials", "Research cohorts", "Security audits", "Operational data"];

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="text-sm font-medium text-cyan-300">{label}</p>
  );
}

function SectionHeading({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <Reveal>
      {children ? (
        <>
          <SectionLabel label={label} />
          <h2
            id={`${id}-title`}
            className="mt-5 max-w-3xl text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:text-5xl"
          >
            {children}
          </h2>
        </>
      ) : (
        <h2 id={`${id}-title`}>
          <SectionLabel label={label} />
        </h2>
      )}
      <div className="mt-8 h-px w-full bg-gradient-to-r from-cyan-400/40 via-white/10 to-transparent" />
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
      className={`inline-flex h-12 items-center gap-2 rounded-xl bg-cyan-400 px-6 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      {ctaLabel}
      <span aria-hidden="true">→</span>
    </button>
  );
}

export default function LandingIntro(props: LandingIntroProps) {
  const { onOpenMarketplace, ctaLabel, ctaDisabled, ctaHint } = props;
  const buttonProps = { onOpenMarketplace, ctaLabel, ctaDisabled };

  return (
    <>
      <section
        aria-labelledby="hero-title"
        className="relative mx-auto flex min-h-[calc(100svh-61px)] max-w-6xl flex-col px-4 sm:px-6"
      >
        <ScrollFade className="flex flex-1 items-center py-16 lg:py-20">
          <div className="max-w-3xl">
            <Reveal once>
              <h1
                id="hero-title"
                className="text-4xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-6xl"
              >
                Ask a question. Get an insight.
              </h1>
            </Reveal>

            <Reveal once delay={120}>
              <p className="mt-8 max-w-xl text-base leading-7 text-slate-400 sm:text-lg sm:leading-8">
                Explore private data, ask what you need to know, and receive an answer without downloading the source files.
              </p>
            </Reveal>
            <Reveal once delay={200}>
              <OpenMarketplaceButton {...buttonProps} className="mt-8" />
              <p className="mt-3 text-sm text-slate-500">{ctaHint}</p>
            </Reveal>
          </div>
        </ScrollFade>

      </section>

      <section
        id="problem"
        aria-labelledby="problem-title"
        className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32"
      >
        <SectionHeading id="problem" label="A better way to use private data">
          Share insight without sharing the source files.
        </SectionHeading>

        <div className="mt-14 grid gap-5 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
          <Reveal from="left">
            <div className={`${LIFT} relative h-full p-6`}>
              <span className="text-sm font-medium text-slate-400">Data owners</span>
              <p className="mt-3 text-[16px] leading-7 text-slate-200">
                Organizations want to monetize insights without handing over source files.
              </p>
            </div>
          </Reveal>
          <div className="hidden items-center justify-center text-2xl text-slate-600 md:flex" aria-hidden="true">
            ⇄
          </div>
          <Reveal from="right" delay={120}>
            <div className={`${LIFT} relative h-full p-6`}>
              <span className="text-sm font-medium text-slate-400">Buyers</span>
              <p className="mt-3 text-[16px] leading-7 text-slate-200">
                Buyers want answers without absorbing unnecessary data.
              </p>
            </div>
          </Reveal>
        </div>

        <Reveal delay={200} className="mx-auto mt-10 max-w-2xl text-center">
          <p className="text-lg font-medium text-white">
            BlindSight helps data owners share useful insights while keeping their source files private.
          </p>
        </Reveal>
      </section>

      <section
        id="how-it-works"
        aria-labelledby="how-it-works-title"
        className="relative scroll-mt-20 overflow-hidden border-y border-white/10 bg-slate-950/50 py-24 sm:py-32"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-64 w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500/[0.06] blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHeading id="how-it-works" label="How it works" />

          <div className="relative mt-14">
            <ol className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_IT_WORKS.map((step, index) => (
                <li key={step.title}>
                  <Reveal delay={index * 100} className="h-full">
                    <div className={`${LIFT} h-full p-5`}>
                      <h3 className="text-base font-semibold text-white">{step.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">{step.description}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section
        id="data-owners"
        aria-labelledby="data-owners-title"
        className="relative scroll-mt-20 overflow-hidden border-y border-white/10 bg-slate-950/25 py-20 sm:py-28"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-cyan-500/[0.04] to-transparent" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
          <Reveal from="left">
            <div className="relative">
              <div className="flex items-center gap-3">
                <SectionLabel label="For data owners" />
              </div>
              <h2 id="data-owners-title" className="mt-7 max-w-2xl text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:text-5xl">
                Set a price per query. Keep control of the source.
              </h2>
            </div>
          </Reveal>

          <Reveal from="right" delay={150}>
            <div className="border-l border-cyan-300/20 pl-6 sm:pl-8">
              <p className="max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                Publish financials, research cohorts, security audits, or operational data.
              </p>
              <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-5 text-[11px] text-slate-400">
                {OWNER_DATA_TYPES.map((type) => (
                  <li key={type} className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-cyan-300/70" />
                    {type}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      <section
        id="buyers-agents"
        aria-labelledby="buyers-agents-title"
        className="relative scroll-mt-20 overflow-hidden border-b border-white/10 py-20 sm:py-28"
      >
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
          <Reveal from="left">
            <div className="relative border-l border-purple-300/20 pl-6 sm:pl-8">
              <p className="max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                Get answers without downloading the underlying files.
              </p>
            </div>
          </Reveal>

          <Reveal from="right" delay={150}>
            <div className="relative">
              <div className="flex items-center gap-3">
                <SectionLabel label="For buyers" />
              </div>
              <h2 id="buyers-agents-title" className="mt-7 max-w-2xl text-3xl font-semibold leading-[1.1] tracking-[-0.025em] text-white sm:text-5xl">
                Ask targeted questions. Pay only for the insight.
              </h2>
            </div>
          </Reveal>
        </div>
      </section>

      <section aria-labelledby="cta-title" className="mx-auto max-w-6xl px-4 py-28 text-center sm:px-6 sm:py-36">
        <Reveal>
          <h2
            id="cta-title"
            className="mx-auto max-w-4xl text-4xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-6xl"
          >
            Get the insight you need.
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <OpenMarketplaceButton {...buttonProps} className="mt-14" />
          <p className="mt-4 text-[12px] text-slate-500">{ctaHint}</p>
        </Reveal>
      </section>
    </>
  );
}
