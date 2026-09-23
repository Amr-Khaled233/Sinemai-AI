import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, Stat } from '@/components/ui';
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

  return (
    <div className="space-y-14">
      <section className="animate-fade-up">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{t('heroKicker')}</p>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight text-strong sm:text-5xl">
          {t('heroTitle')}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-muted">{t('heroBody')}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={session?.user ? homeForRole(session.user.role) : '/register'} className="btn-primary">
            {t('ctaPrimary')}
          </Link>
          <Link href="/register" className="btn-secondary">
            {t('ctaSecondary')}
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Catalog items" value={equipmentCount} />
        <Stat label="Cinematographers" value={dopCount} />
        <Stat label="Rental vendors" value={vendorCount} />
        <Stat label="Sheets generated" value={projectCount} />
      </section>

      <section>
        <h2 className="mb-5 text-xl font-semibold text-strong">{t('howTitle')}</h2>
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="card p-5">
              <span className="text-xs font-semibold text-accent">0{index + 1}</span>
              <h3 className="mt-2 text-sm font-semibold text-strong">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={t('trustTitle')}>
          <p className="prose-sheet">{t('trustBody')}</p>
        </Card>
        <div className="grid gap-4">
          <Card title={t('forVendors')}>
            <p className="prose-sheet">{t('forVendorsBody')}</p>
          </Card>
          <Card title={t('forDops')}>
            <p className="prose-sheet">{t('forDopsBody')}</p>
          </Card>
        </div>
      </section>
    </div>
  );
}
