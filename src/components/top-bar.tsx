import { getTranslations } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';
import { CurrencySwitcher } from '@/components/currency-switcher';
import { getDisplayCurrency } from '@/lib/currency-server';
import { SignOutButton } from '@/components/sign-out-button';
import { NavLinks, type NavLink } from '@/components/nav-links';
import { countUnreadInquiries } from '@/lib/inquiries';

const NAV_BY_ROLE: Record<Role, NavLink[]> = {
  PRODUCER: [
    { href: '/producer', key: 'projects' },
    { href: '/producer/projects/new', key: 'newProject' },
    { href: '/producer/inquiries', key: 'inquiries' },
    { href: '/producer/insights', key: 'insights' },
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
    { href: '/admin/rentals', key: 'rentals' },
    { href: '/admin/vendors', key: 'vendors' },
    { href: '/admin/dops', key: 'dops' },
    { href: '/admin/content', key: 'content' },
    { href: '/admin/settings', key: 'settings' },
  ],
};

export async function TopBar({ locale }: { locale: string }) {
  const [t, session, currency] = await Promise.all([getTranslations('nav'), auth(), getDisplayCurrency()]);
  const role = session?.user?.role;
  const links = role ? NAV_BY_ROLE[role] : [];

  // Vendors and cinematographers should see a waiting inquiry without opening
  // the page; producers are notified by the reply itself.
  const unread =
    session?.user && (role === 'VENDOR' || role === 'DOP')
      ? await countUnreadInquiries(session.user.id, role === 'VENDOR' ? 'vendor' : 'dop').catch(() => 0)
      : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href={role ? homeForRole(role) : '/'} className="shrink-0" aria-label="Sinemai AI">
          <Logo />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex">
          <NavLinks links={links} badges={{ inquiries: unread }} />
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <CurrencySwitcher current={currency.code} options={currency.options} />
          <LocaleSwitcher locale={locale} />
          {session?.user ? (
            <>
              <span className="ms-1 hidden max-w-[12rem] truncate text-xs text-muted sm:inline">
                {session.user.name}
              </span>
              <SignOutButton label={t('logout')} locale={locale} />
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost hidden text-xs sm:inline-flex">
                {t('login')}
              </Link>
              <Link href="/register" className="btn-primary px-4 text-xs">
                {t('register')}
              </Link>
            </>
          )}
        </div>
      </div>

      {links.length > 0 && (
        <nav className="flex gap-1.5 overflow-x-auto border-t border-line/60 px-4 py-2 md:hidden">
          <NavLinks links={links} variant="pills" badges={{ inquiries: unread }} />
        </nav>
      )}
    </header>
  );
}
