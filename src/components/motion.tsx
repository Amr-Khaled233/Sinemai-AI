'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Motion primitives.
 *
 * Deliberately CSS-driven and dependency-free: an IntersectionObserver toggles
 * one class, the transition lives in globals.css, and everything degrades to a
 * plain static layout when `prefers-reduced-motion` is set or JS never runs.
 */

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fades and lifts its children into view the first time they are scrolled to. */
export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className,
}: {
  children: ReactNode;
  /** Stagger in milliseconds; keep steps small so a list does not crawl in. */
  delay?: number;
  as?: ElementType;
  className?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No observer support, or motion turned off: show immediately.
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}
      className={cn('reveal', shown && 'reveal-in', className)}
    >
      {children}
    </Tag>
  );
}

/**
 * Counts up to a number once it is on screen. Falls back to the final value
 * without animating when motion is reduced, so the figure is never wrong.
 */
export function AnimatedNumber({
  value,
  duration = 900,
  suffix = '',
  className,
}: {
  value: number;
  duration?: number;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined' || value === 0) {
      setDisplay(value);
      return;
    }

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();

        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / duration);
          // Ease-out so the count decelerates into its final value.
          const eased = 1 - Math.pow(1 - progress, 3);
          setDisplay(Math.round(value * eased));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.2 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {display}
      {suffix}
    </span>
  );
}

/** A bar that grows to its width when scrolled to. */
export function MeterFill({
  pct,
  className,
  delay = 0,
}: {
  pct: number;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const target = Math.max(0, Math.min(100, pct));

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      setWidth(target);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const timer = setTimeout(() => setWidth(target), delay);
        return () => clearTimeout(timer);
      },
      { threshold: 0.3 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [pct, delay]);

  return (
    <div ref={ref} className="h-full w-full">
      <div
        className={cn('h-full rounded-full transition-[width] duration-700 ease-smooth', className)}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
