import { getTranslations } from 'next-intl/server';
import type { Role } from '@prisma/client';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { SignOutButton } from '@/components/sign-out-button';
import { NavLinks, type NavLink } from '@/components/nav-links';
import { countUnreadInquiries } from '@/lib/inquiries';

const NAV_BY_ROLE: Record<Role, NavLink[]> = {
  PRODUCER: [
    { href: '/producer', key: 'projects' },
    { href: '/producer/projects/new', key: 'newProject' },
    { href: '/producer/inquiries', key: 'inquiries' },
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

  // Vendors and cinematographers should see a waiting inquiry without opening
  // the page; producers are notified by the reply itself.
  const unread =
    session?.user && (role === 'VENDOR' || role === 'DOP')
      ? await countUnreadInquiries(session.user.id, role === 'VENDOR' ? 'vendor' : 'dop').catch(() => 0)
      : 0;

  return (
    <header className="glass sticky top-0 z-40 border-b border-line/70">
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6">
        <Link href={role ? homeForRole(role) : '/'} className="group flex items-center gap-2.5">
          <span className="relative grid size-9 place-items-center overflow-hidden rounded-xl border border-accent/40 bg-gradient-to-br from-accent/20 to-transparent text-sm font-bold text-accent transition-transform duration-300 ease-smooth group-hover:scale-105">
            س
            {/* A light sweep on hover, mirrored automatically in RTL. */}
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-smooth group-hover:translate-x-full"
            />
          </span>
          <span className="hidden whitespace-nowrap text-sm font-semibold tracking-wide text-strong transition-colors group-hover:text-accent min-[400px]:inline">
            Sinemai <span className="text-accent">AI</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex">
          <NavLinks links={links} badges={{ inquiries: unread }} />
        </nav>

        <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          <ThemeToggle />
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
        <nav className="flex gap-1.5 overflow-x-auto border-t border-line/60 px-4 py-2 md:hidden">
          <NavLinks links={links} variant="pills" badges={{ inquiries: unread }} />
        </nav>
      )}
    </header>
  );
}
