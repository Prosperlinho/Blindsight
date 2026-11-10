import type { ReactNode } from "react";

/*
 * Light, hand-drawn decorations for the landing page. Strokes use the
 * `.sketch-path` class and draw themselves in when an ancestor `Reveal`
 * becomes visible. All of these are decorative and hidden from assistive tech.
 */

type Tone = "cyan" | "purple" | "slate";

const TONE_TEXT: Record<Tone, string> = {
  cyan: "text-cyan-200/90",
  purple: "text-purple-200/90",
  slate: "text-slate-300/90",
};

const TONE_BORDER: Record<Tone, string> = {
  cyan: "border-cyan-300/30",
  purple: "border-purple-300/30",
  slate: "border-white/20",
};

/** A small tilted note card with a dashed hand-drawn border and a tape strip. */
export function SketchNote({
  children,
  letter,
  tone = "cyan",
  className = "",
}: {
  children: ReactNode;
  letter?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`sketch-border relative border border-dashed bg-slate-950/40 px-4 pb-3 pt-4 backdrop-blur-sm ${TONE_BORDER[tone]} ${className}`}
    >
      <span className="absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 rotate-[-4deg] rounded-[2px] bg-white/[0.07]" />
      <div className={`font-hand flex items-start gap-2.5 text-[19px] leading-[1.15] ${TONE_TEXT[tone]}`}>
        {letter && <SketchLetter letter={letter} tone={tone} />}
        <span className="min-w-0">{children}</span>
      </div>
    </div>
  );
}

/** A letter inside a loosely drawn circle, like a margin marker. */
export function SketchLetter({ letter, tone = "cyan" }: { letter: string; tone?: Tone }) {
  return (
    <span className={`relative grid size-8 shrink-0 place-items-center font-hand text-[20px] ${TONE_TEXT[tone]}`}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full" fill="none">
        <path
          className="sketch-path"
          pathLength={1}
          d="M20 3c9 0 16 7.5 16 16.5S29 37 19.5 37 4 29.5 4.5 20 11 3.5 21.5 4.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      {letter}
    </span>
  );
}

/** Wavy hand-drawn underline. Place inside a `relative` inline wrapper. */
export function SketchUnderline({ className = "", tone = "cyan" }: { className?: string; tone?: Tone }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 300 16"
      preserveAspectRatio="none"
      fill="none"
      className={`pointer-events-none ${TONE_TEXT[tone]} ${className}`}
    >
      <path
        className="sketch-path"
        pathLength={1}
        d="M3 11c40-6 78-8 118-5s84 4 120-1 42-3 56-1"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Loose oval drawn around a phrase. Place inside a `relative` wrapper. */
export function SketchCircle({ className = "", tone = "purple" }: { className?: string; tone?: Tone }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 90"
      preserveAspectRatio="none"
      fill="none"
      className={`pointer-events-none absolute ${TONE_TEXT[tone]} ${className}`}
    >
      <path
        className="sketch-path"
        pathLength={1}
        d="M168 6C82 3 10 18 8 45s70 40 158 39 148-14 146-41S240 4 140 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A curved arrow with a hand-drawn head. */
export function SketchArrow({
  className = "",
  tone = "slate",
  flip = false,
}: {
  className?: string;
  tone?: Tone;
  flip?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 90 60"
      fill="none"
      className={`pointer-events-none ${TONE_TEXT[tone]} ${flip ? "-scale-x-100" : ""} ${className}`}
    >
      <path
        className="sketch-path"
        pathLength={1}
        d="M6 10c14 28 38 40 70 38"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        className="sketch-path"
        pathLength={1}
        d="M66 38l11 10-13 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Hand-drawn check (✓) or cross (✕) mark. */
export function SketchMark({ kind, className = "", tone = "cyan" }: { kind: "check" | "cross"; className?: string; tone?: Tone }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className={`inline-block ${TONE_TEXT[tone]} ${className}`}>
      {kind === "check" ? (
        <path className="sketch-path" pathLength={1} d="M4 13.5l5 5.5L20.5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <path className="sketch-path" pathLength={1} d="M5 5.5l14 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path className="sketch-path" pathLength={1} d="M19 5l-13.5 14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
