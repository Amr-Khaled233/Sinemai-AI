import { cn } from '@/lib/utils';

/**
 * The brand mark: a six-blade lens aperture on a signal-yellow tile, beside a
 * condensed SINEMAI wordmark. The mark carries fixed colours so it reads the
 * same in both themes; the wordmark follows the text colour.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-9 shrink-0', className)} aria-hidden>
      <rect width="40" height="40" rx="8" fill="#E3B823" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="#141213" strokeWidth="2.4" />
      {/* Aperture blades: six chords turned 60° apart around the centre. */}
      <g stroke="#141213" strokeWidth="2.2" strokeLinecap="round">
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <line key={angle} x1="20" y1="8.5" x2="25.2" y2="17" transform={`rotate(${angle} 20 20)`} />
        ))}
      </g>
      <circle cx="20" cy="20" r="3" fill="#141213" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} dir="ltr">
      <LogoMark />
      <span className="font-display text-lg font-semibold uppercase leading-none tracking-[0.08em] text-strong">
        Sinemai<span className="ms-1.5 text-accent">AI</span>
      </span>
    </span>
  );
}
