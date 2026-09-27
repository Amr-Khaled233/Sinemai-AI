import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';
import { SignOutButton } from '@/components/sign-out-button';
import { NavLinks, type NavLink } from '@/components/nav-links';
import { MobileMenu } from '@/components/mobile-menu';
import { unreadThreadCount } from '@/lib/support';

/** Everyone who is not the admin is a regular user with the same menu. */
const USER_NAV: NavLink[] = [
  { href: '/producer', key: 'projects' },
  { href: '/producer/equipment', key: 'equipment' },
  { href: '/producer/insights', key: 'insights' },
  { href: '/producer/support', key: 'support' },
];

const ADMIN_NAV: NavLink[] = [
  { href: '/admin', key: 'analytics' },
  { href: '/admin/users', key: 'users' },
  { href: '/admin/support', key: 'support' },
  { href: '/admin/equipment', key: 'equipment' },
  { href: '/admin/rentals', key: 'rentals' },
  { href: '/admin/vendors', key: 'vendors' },
  { href: '/admin/content', key: 'content' },
  { href: '/admin/settings', key: 'settings' },
];

export async function TopBar({ locale }: { locale: string }) {
  const [t, session] = await Promise.all([getTranslations('nav'), auth()]);
  const role = session?.user?.role;
  const isAdmin = role === 'ADMIN';
  const links = !role ? [] : isAdmin ? ADMIN_NAV : USER_NAV;

  // Conversations waiting on this person, shown on the Support link.
  const unread = session?.user
    ? await unreadThreadCount({ id: session.user.id, isAdmin }).catch(() => 0)
    : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href={role ? homeForRole(role) : '/'} className="shrink-0" aria-label="Sinemai AI">
          <Logo />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
          <NavLinks links={links} badges={{ support: unread }} />
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <ThemeToggle />
          {/* Desktop: everything side by side. */}
          <div className="hidden items-center gap-2 md:flex">
            <LocaleSwitcher locale={locale} />
            {session?.user ? (
              <SignOutButton label={t('logout')} locale={locale} />
            ) : (
              <>
                <Link href="/login" className="btn-ghost text-xs">
                  {t('login')}
                </Link>
                <Link href="/register" className="btn-primary px-4 text-xs">
                  {t('register')}
                </Link>
              </>
            )}
          </div>
          {/* Phone: one menu with the pages, the language and the account actions. */}
          <MobileMenu links={links} badges={{ support: unread }} locale={locale} signedIn={Boolean(session?.user)} />
        </div>
      </div>
    </header>
  );
}
