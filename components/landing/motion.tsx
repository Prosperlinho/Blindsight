"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Delay before the reveal transition starts, in ms. */
  delay?: number;
  from?: "up" | "left" | "right" | "pop";
  /** Resting rotation in degrees (used by tilted sketch notes). */
  rotate?: number;
  /**
   * When false (default) the element fades back out once it leaves the
   * viewport, so content disappears as the visitor scrolls past it.
   */
  once?: boolean;
  threshold?: number;
};

/**
 * Fades its children in when they scroll into view and, unless `once` is set,
 * fades them out again when they leave. Exposes `data-visible` so nested
 * sketch strokes can draw themselves in sync.
 */
export function Reveal({
  children,
  className = "",
  delay = 0,
  from = "up",
  rotate = 0,
  once = false,
  threshold = 0.2,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (prefersReducedMotion() || !("IntersectionObserver" in window)) {
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [once, threshold]);

  const style = {
    "--reveal-delay": `${delay}ms`,
    "--reveal-rotate": `${rotate}deg`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      data-visible={visible}
      data-from={from === "up" ? undefined : from}
      style={style}
      className={`reveal ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Fades and lifts its children away as the page scrolls, reaching zero
 * opacity after `distance` (fraction of viewport height). Used on the hero.
 */
export function ScrollFade({
  children,
  className = "",
  distance = 0.7,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || prefersReducedMotion()) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * distance)));
      element.style.opacity = String(1 - progress);
      element.style.transform = `translate3d(0, ${progress * -48}px, 0) scale(${1 - progress * 0.04})`;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [distance]);

  return (
    <div ref={ref} className={`will-change-transform ${className}`}>
      {children}
    </div>
  );
}
