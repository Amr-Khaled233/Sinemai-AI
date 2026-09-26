import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { MeterFill } from '@/components/motion';

export function Card({
  children,
  className,
  title,
  action,
  subtitle,
  interactive,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  interactive?: boolean;
}) {
  return (
    <section className={cn('card p-5 sm:p-6', interactive && 'card-interactive', className)}>
      {(title || action) && (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-strong">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs leading-5 text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4', className)}>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-5 text-muted/80">{hint}</p>}
      {error && (
        <p className="mt-1.5 animate-fade-in text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('input min-h-28 resize-y leading-7', className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={cn('input appearance-none pe-9', className)}>
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute inset-y-0 end-3 my-auto size-4 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="stat group">
      <div className="flex items-start justify-between gap-2">
        <div className="stat-label">{label}</div>
        {icon && <span className="text-accent/70 transition-transform group-hover:scale-110">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'border-line text-muted',
  gold: 'border-accent/50 bg-accent/10 text-accent',
  teal: 'border-info/40 bg-info/10 text-info',
  green: 'border-success/40 bg-success/10 text-success',
  red: 'border-danger/40 bg-danger/10 text-danger',
  amber: 'border-warning/40 bg-warning/10 text-warning',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  className,
  pulse,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  className?: string;
  /** Adds a soft pulsing dot — used for live states such as "analyzing". */
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {pulse && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-current" />
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  action,
  icon,
}: {
  title: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="animate-fade-in rounded-lg border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-3 flex justify-center text-muted/50">{icon}</div>}
      <p className="text-sm text-muted">{title}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-strong sm:text-xl">{children}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** Horizontal share of a whole, used for scene mixes. Segments grow on reveal. */
export function MeterBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; className: string }>;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-line/70">
        {segments.map((segment, index) => (
          <div
            key={segment.label}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          >
            <MeterFill pct={100} delay={index * 90} className={cn(segment.className, 'rounded-none')} />
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {segments
          .filter((s) => s.value > 0)
          .map((segment) => (
            <span key={segment.label} className="inline-flex items-center gap-1.5">
              <span className={cn('inline-block size-2 rounded-sm', segment.className)} />
              {segment.label} · {segment.value}
            </span>
          ))}
      </div>
    </div>
  );
}

/** Loading placeholder that matches the shape of the content it replaces. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

export function SkeletonCard() {
  return (
    <div className="card p-5">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="mt-3 h-3 w-2/3" />
      <Skeleton className="mt-6 h-2 w-full" />
      <Skeleton className="mt-2 h-2 w-5/6" />
    </div>
  );
}

/** Inline spinner sized to the current font. */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={cn('size-4 animate-spin', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={cn('size-4', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" strokeDasharray="24" className="animate-draw-check" />
    </svg>
  );
}

