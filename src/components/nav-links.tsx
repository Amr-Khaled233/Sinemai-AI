'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/routing';
import { cn } from '@/lib/utils';

export type NavLink = { href: string; key: string };

/**
 * Nav with an active indicator. Client-side because it needs the current path;
 * the links themselves are still next-intl Links, so locale prefixes are kept.
 */
export function NavLinks({
  links,
  variant = 'bar',
  /** Optional count shown beside a link, keyed by the link's translation key. */
  badges = {},
}: {
  links: NavLink[];
  variant?: 'bar' | 'pills';
  badges?: Record<string, number>;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === pathname || (href !== '/' && pathname.startsWith(`${href}/`));

  if (variant === 'pills') {
    return (
      <>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(link.href) ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs transition-colors duration-200',
              isActive(link.href)
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-transparent text-muted hover:text-strong',
            )}
          >
            {t(link.key)}
            {badges[link.key] ? <Count value={badges[link.key]} /> : null}
          </Link>
        ))}
      </>
    );
  }

  return (
    <>
      {links.map((link) => {
        const active = isActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative rounded-lg px-3 py-1.5 text-sm transition-colors duration-200',
              active ? 'text-strong' : 'text-muted hover:text-strong',
            )}
          >
            {t(link.key)}
            {badges[link.key] ? <Count value={badges[link.key]} /> : null}
            {/* The underline grows from the centre, so it reads the same in RTL. */}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-2 -bottom-px h-0.5 origin-center rounded-full bg-accent transition-transform duration-300 ease-smooth',
                active ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </Link>
        );
      })}
    </>
  );
}

/** Small unread counter; capped so a long backlog cannot stretch the nav. */
function Count({ value }: { value: number }) {
  return (
    <span className="ms-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-ink-950">
      {value > 9 ? '9+' : value}
    </span>
  );
}
