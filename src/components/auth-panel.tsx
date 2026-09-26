import type { ReactNode } from 'react';
import { LogoMark } from '@/components/logo';

/** The one frame every credential screen uses: mark, title, form, footer links. */
export function AuthPanel({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md animate-fade-up pt-4 sm:pt-12">
      <div className="card p-6 sm:p-9">
        <LogoMark className="size-10" />
        <h1 className="mt-6 text-2xl font-semibold uppercase text-strong rtl:normal-case">{title}</h1>
        {subtitle && <p className="mt-2 text-sm leading-6 text-muted">{subtitle}</p>}
        <div className="mt-7">{children}</div>
        {footer && <div className="mt-6 space-y-2 border-t border-line pt-5 text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}
