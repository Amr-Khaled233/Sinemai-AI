import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui';
import { AnimatedNumber, Aurora, Reveal } from '@/components/motion';
import type { AppLocale } from '@/i18n/routing';

// Platform counters are live-ish rather than frozen into the prerendered page.
export const revalidate = 300;

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const [t, session] = await Promise.all([getTranslations('landing'), auth()]);
  const [equipmentCount, dopCount, vendorCount, projectCount] = await Promise.all([
    prisma.equipment.count({ where: { active: true } }),
    prisma.dop.count({ where: { status: 'APPROVED' } }),
    prisma.vendor.count({ where: { status: 'APPROVED' } }),
    prisma.project.count({ where: { status: 'READY' } }),
  ]).catch(() => [0, 0, 0, 0]);

  const steps = [
    { title: t('step1Title'), body: t('step1Body') },
    { title: t('step2Title'), body: t('step2Body') },
    { title: t('step3Title'), body: t('step3Body') },
    { title: t('step4Title'), body: t('step4Body') },
  ];

  const stats = [
    { label: t('statEquipment'), value: equipmentCount },
    { label: t('statDops'), value: dopCount },
    { label: t('statVendors'), value: vendorCount },
    { label: t('statSheets'), value: projectCount },
  ];

  return (
    <div className="space-y-24 pb-8">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative -mt-8 pt-14 sm:pt-20">
        {/* Decoration spans the viewport, not the padded container, so it never
            draws a visible rectangle edge beside the content. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden rtl:translate-x-1/2"
        >
          <Aurora />
          <div className="absolute inset-x-0 top-0 h-72 bg-grid opacity-[0.3]" />
        </div>

        <div className="animate-fade-up">
          <p className="eyebrow">{t('heroKicker')}</p>
          <h1 className="mt-5 max-w-4xl text-[2rem] font-semibold leading-[1.15] sm:text-5xl sm:leading-[1.12] lg:text-6xl">
            <span className="headline-gradient">{t('heroTitle')}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[0.95rem] leading-7 text-muted sm:mt-6 sm:text-lg sm:leading-8">
            {t('heroBody')}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:mt-9 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              href={session?.user ? homeForRole(session.user.role) : '/register'}
              className="btn-primary px-5 py-3 text-base"
            >
              {t('ctaPrimary')}
              <svg
                aria-hidden
                viewBox="0 0 20 20"
                className="size-4 rtl:-scale-x-100"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 10h11M11 6l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link href="/register" className="btn-secondary px-5 py-3 text-base">
              {t('ctaSecondary')}
            </Link>
          </div>
        </div>

        <Reveal delay={150} className="mt-16">
          <dl className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="stat">
                <dt className="stat-label">{stat.label}</dt>
                <dd className="stat-value">
                  <AnimatedNumber value={stat.value} />
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section>
        <Reveal>
          <h2 className="text-2xl font-semibold text-strong sm:text-3xl">{t('howTitle')}</h2>
        </Reveal>

        <ol className="relative mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* A hairline ties the four steps into one sequence on wide screens. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-12 hidden h-px bg-gradient-to-r from-transparent via-line-strong to-transparent lg:block"
          />
          {steps.map((step, index) => (
            <Reveal as="li" key={step.title} delay={index * 90} className="relative">
              <div className="card card-interactive h-full p-5">
                <span className="relative z-10 inline-flex size-9 items-center justify-center rounded-xl border border-accent/40 bg-accent/10 text-sm font-semibold text-accent">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-4 text-sm font-semibold text-strong">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------------ trust */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <Card className="h-full" title={t('trustTitle')}>
            <p className="prose-sheet text-base leading-8">{t('trustBody')}</p>

            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[t('trustPoint1'), t('trustPoint2'), t('trustPoint3'), t('trustPoint4')].map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm leading-6 text-muted">
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    className="mt-0.5 size-4 shrink-0 text-accent"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {point}
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>

        <div className="grid gap-4">
          <Reveal delay={100}>
            <Card interactive title={t('forVendors')}>
              <p className="prose-sheet">{t('forVendorsBody')}</p>
              <Link href="/register" className="tap-link mt-4 text-xs text-accent hover:underline">
                {t('ctaSecondary')} →
              </Link>
            </Card>
          </Reveal>
          <Reveal delay={180}>
            <Card interactive title={t('forDops')}>
              <p className="prose-sheet">{t('forDopsBody')}</p>
              <Link href="/register" className="tap-link mt-4 text-xs text-accent hover:underline">
                {t('ctaSecondary')} →
              </Link>
            </Card>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------ closing CTA */}
      <Reveal>
        <section className="relative overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/10 via-surface to-surface p-6 text-center sm:p-14">
          <div aria-hidden className="absolute inset-0 -z-10 bg-grid opacity-25" />
          <h2 className="text-xl font-semibold text-strong sm:text-3xl lg:text-4xl">{t('heroTitle')}</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-muted">{t('closingBody')}</p>
          <Link
            href={session?.user ? homeForRole(session.user.role) : '/register'}
            className="btn-primary mt-7 px-6 py-3 text-base"
          >
            {t('ctaPrimary')}
          </Link>
        </section>
      </Reveal>
    </div>
  );
}
