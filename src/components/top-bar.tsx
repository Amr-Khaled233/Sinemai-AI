import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/logo';
import { SignOutButton } from '@/components/sign-out-button';
import { NavLinks, type NavLink } from '@/components/nav-links';

/** Everyone who is not the admin is a regular user with the same menu. */
const USER_NAV: NavLink[] = [
  { href: '/producer', key: 'projects' },
  { href: '/producer/projects/new', key: 'newProject' },
  { href: '/producer/equipment', key: 'equipment' },
  { href: '/producer/insights', key: 'insights' },
];

const ADMIN_NAV: NavLink[] = [
  { href: '/admin', key: 'analytics' },
  { href: '/admin/users', key: 'users' },
  { href: '/admin/equipment', key: 'equipment' },
  { href: '/admin/rentals', key: 'rentals' },
  { href: '/admin/vendors', key: 'vendors' },
  { href: '/admin/dops', key: 'dops' },
  { href: '/admin/content', key: 'content' },
  { href: '/admin/settings', key: 'settings' },
];

export async function TopBar({ locale }: { locale: string }) {
  const [t, session] = await Promise.all([getTranslations('nav'), auth()]);
  const role = session?.user?.role;
  const links = !role ? [] : role === 'ADMIN' ? ADMIN_NAV : USER_NAV;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Link href={role ? homeForRole(role) : '/'} className="shrink-0" aria-label="Sinemai AI">
          <Logo />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
          <NavLinks links={links} />
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <LocaleSwitcher locale={locale} />
          {session?.user ? (
            <SignOutButton label={t('logout')} locale={locale} />
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
        <nav className="no-scrollbar flex gap-1.5 overflow-x-auto border-t border-line/60 px-4 py-2 md:hidden">
          <NavLinks links={links} variant="pills" />
        </nav>
      )}
    </header>
  );
}
