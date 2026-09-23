import { getTranslations } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/sign-out-button';

const NAV_BY_ROLE: Record<Role, Array<{ href: string; key: string }>> = {
  PRODUCER: [
    { href: '/producer', key: 'projects' },
    { href: '/producer/projects/new', key: 'newProject' },
  ],
  VENDOR: [
    { href: '/vendor', key: 'dashboard' },
    { href: '/vendor/inventory', key: 'inventory' },
    { href: '/vendor/inquiries', key: 'inquiries' },
  ],
  DOP: [
    { href: '/dop', key: 'profile' },
    { href: '/dop/inquiries', key: 'inquiries' },
  ],
  ADMIN: [
    { href: '/admin', key: 'analytics' },
    { href: '/admin/equipment', key: 'equipment' },
    { href: '/admin/vendors', key: 'vendors' },
    { href: '/admin/dops', key: 'dops' },
    { href: '/admin/settings', key: 'settings' },
  ],
};

export async function TopBar({ locale }: { locale: string }) {
  const [t, session] = await Promise.all([getTranslations('nav'), auth()]);
  const role = session?.user?.role;
  const links = role ? NAV_BY_ROLE[role] : [];

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-page/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href={role ? homeForRole(role) : '/'} className="group flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-md border border-accent/60 bg-accent/10 text-sm font-bold text-accent">
            س
          </span>
          <span className="text-sm font-semibold tracking-wide text-strong group-hover:text-accent">
            Sinemai <span className="text-accent">AI</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-raised hover:text-strong"
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <ThemeToggle />
          <LocaleSwitcher locale={locale} />
          {session?.user ? (
            <>
              <span className="hidden text-xs text-muted sm:inline">{session.user.name}</span>
              <SignOutButton label={t('logout')} locale={locale} />
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost text-xs">
                {t('login')}
              </Link>
              <Link href="/register" className="btn-primary text-xs">
                {t('register')}
              </Link>
            </>
          )}
        </div>
      </div>

      {links.length > 0 && (
        <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted hover:text-strong"
            >
              {t(link.key)}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
