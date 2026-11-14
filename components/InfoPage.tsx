import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";

type Section = { id: string; title: string };

// Shared shell for long-form pages (docs, privacy): header, table of contents, prose body.
export default function InfoPage({
  eyebrow,
  title,
  intro,
  sections,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  sections: Section[];
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-x-clip text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0B1120]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="BlindSight home">
            <Image src="/logo-mark.png" alt="" width={32} height={32} className="size-8 object-contain" priority />
            <span className="text-sm font-semibold tracking-[0.08em] text-white">BlindSight</span>
          </Link>
          <nav aria-label="Site" className="ml-auto">
            <ul className="flex items-center gap-1 text-xs text-slate-400">
              <li>
                <Link href="/docs" className="rounded-full px-3 py-1.5 transition hover:bg-white/5 hover:text-white">
                  Docs
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="rounded-full px-3 py-1.5 transition hover:bg-white/5 hover:text-white">
                  Privacy
                </Link>
              </li>
            </ul>
          </nav>
          <Link
            href="/marketplace"
            className="ml-2 inline-flex min-h-9 items-center rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
          >
            Open Marketplace
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:pt-14">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">On this page</p>
            <ul className="space-y-1.5 text-sm">
              {sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="text-slate-400 transition hover:text-white">
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="min-w-0 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300/80">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
          <div className="mt-4 text-base leading-7 text-slate-300">{intro}</div>
          <div className="info-prose mt-10 space-y-12">{children}</div>
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}

export function InfoSection({ id, title, children }: Section & { children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-slate-300">{children}</div>
    </section>
  );
}
