import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({
  children,
  className,
  title,
  action,
  subtitle,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={cn('card p-5', className)}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-[rgb(var(--muted))]">{subtitle}</p>}
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
      {hint && <p className="mt-1.5 text-xs text-[rgb(var(--muted))]/80">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('input min-h-28 resize-y', className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn('input appearance-none', className)}>
      {children}
    </select>
  );
}

export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="mt-1 text-xs text-[rgb(var(--muted))]">{hint}</div>}
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'border-ink-600 text-[rgb(var(--muted))]',
  gold: 'border-brass-500/60 bg-brass-500/10 text-brass-400',
  teal: 'border-teal-500/50 bg-teal-500/10 text-teal-400',
  green: 'border-emerald-600/50 bg-emerald-600/10 text-emerald-400',
  red: 'border-red-700/60 bg-red-900/20 text-red-300',
  amber: 'border-amber-600/50 bg-amber-600/10 text-amber-300',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-600 px-6 py-10 text-center">
      <p className="text-sm text-[rgb(var(--muted))]">{title}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-white">{children}</h2>
      {hint && <p className="mt-1 text-sm text-[rgb(var(--muted))]">{hint}</p>}
    </div>
  );
}

/** Horizontal share of a whole, used for scene mixes. */
export function MeterBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; className: string }>;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink-700">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.className}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[rgb(var(--muted))]">
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
