import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AnimatedNumber, Reveal } from '@/components/motion';
import type { AppLocale } from '@/i18n/routing';

// Platform counters are live-ish rather than frozen into the prerendered page.
export const revalidate = 300;

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const [t, tSheet, session] = await Promise.all([getTranslations('landing'), getTranslations('sheet'), auth()]);
  const [equipmentCount, dopCount, vendorCount, projectCount] = await Promise.all([
    prisma.equipment.count({ where: { active: true } }),
    prisma.dop.count({ where: { status: 'APPROVED' } }),
    prisma.vendor.count({ where: { status: 'APPROVED' } }),
    prisma.project.count({ where: { status: 'READY' } }),
  ]).catch(() => [0, 0, 0, 0]);

  const start = session?.user ? homeForRole(session.user.role) : '/register';

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
    <div className="space-y-20 pb-4 sm:space-y-28">
      {/* ------------------------------------------------------------ hero */}
      <section className="animate-fade-up pt-6 sm:pt-14">
        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="eyebrow">{t('heroKicker')}</p>
            <h1 className="mt-5 text-[2.25rem] font-semibold uppercase leading-[1.1] text-strong sm:text-6xl rtl:normal-case rtl:leading-[1.35]">
              {t('heroTitle')}
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">{t('heroBody')}</p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={start} className="btn-primary px-7 py-3">
                {t('ctaPrimary')}
                <ArrowIcon />
              </Link>
              <a href="#how" className="btn-secondary px-7 py-3">
                {t('howTitle')}
              </a>
            </div>
          </div>

          <SheetPreview
            labels={{
              title: tSheet('title'),
              scenes: tSheet('scenes'),
              shootDays: tSheet('shootDays'),
              night: tSheet('nightScenes'),
              package: tSheet('equipmentTitle'),
              budget: tSheet('budgetTitle'),
              low: tSheet('budgetLow'),
              high: tSheet('budgetHigh'),
            }}
            locale={locale}
          />
        </div>

        <dl className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse bg-surface p-5 sm:p-6">
              <dt className="mt-1 text-xs text-muted">{stat.label}</dt>
              <dd className="font-display text-3xl font-semibold tabular-nums text-strong sm:text-4xl">
                <AnimatedNumber value={stat.value} />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section id="how" className="scroll-mt-24">
        <Reveal>
          <p className="eyebrow">01 — 04</p>
          <h2 className="mt-3 text-3xl font-semibold uppercase text-strong sm:text-4xl rtl:normal-case">
            {t('howTitle')}
          </h2>
        </Reveal>

        <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <Reveal as="li" key={step.title} delay={index * 80} className="bg-surface p-6">
              <span className="font-display text-sm font-semibold text-accent">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-strong">{step.title}</h3>
              <p className="mt-2 text-sm leading-7 text-muted">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------------ trust */}
      <section className="grid gap-10 lg:grid-cols-5 lg:gap-16">
        <Reveal className="lg:col-span-2">
          <h2 className="text-3xl font-semibold uppercase text-strong sm:text-4xl rtl:normal-case">{t('trustTitle')}</h2>
          <p className="mt-5 text-base leading-8 text-muted">{t('trustBody')}</p>
        </Reveal>

        <ul className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
          {[t('trustPoint1'), t('trustPoint2'), t('trustPoint3'), t('trustPoint4')].map((point, index) => (
            <Reveal as="li" key={point} delay={index * 60} className="card flex gap-3 p-5 text-sm leading-7 text-body">
              <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-brass-500 text-ink-950">
                <svg aria-hidden viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              {point}
            </Reveal>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ closing CTA */}
      <Reveal>
        <section className="rounded-lg bg-brass-500 px-6 py-14 text-center sm:px-14 sm:py-20">
          <h2 className="mx-auto max-w-3xl text-2xl font-semibold uppercase leading-tight text-ink-950 sm:text-4xl rtl:normal-case">
            {t('heroTitle')}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-ink-950/75">{t('closingBody')}</p>
          <Link href={start} className="btn mt-8 bg-ink-950 px-8 py-3 text-white hover:-translate-y-0.5 hover:bg-ink-800">
            {t('ctaPrimary')}
            <ArrowIcon />
          </Link>
        </section>
      </Reveal>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 10h11M11 6l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * An illustrative sheet beside the hero, so the page shows the product instead
 * of describing it. Equipment names and numbers are language-neutral; every
 * label comes from the real sheet's own strings.
 */
function SheetPreview({
  labels,
  locale,
}: {
  labels: Record<'title' | 'scenes' | 'shootDays' | 'night' | 'package' | 'budget' | 'low' | 'high', string>;
  locale: string;
}) {
  const money = (value: number) =>
    new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-SA', {
      style: 'currency',
      currency: 'SAR',
      maximumFractionDigits: 0,
    }).format(value);
  const format = (value: number) => new Intl.NumberFormat('en').format(value);

  const facts = [
    { label: labels.scenes, value: format(24) },
    { label: labels.shootDays, value: format(4) },
    { label: labels.night, value: `${format(38)}%` },
  ];
  const packageLines = [
    ['ARRI ALEXA 35', '×1'],
    ['Cooke S4/i Prime Set', '×1'],
    ['ARRI SkyPanel S60-C', '×4'],
    ['Aputure LS 600d Pro', '×2'],
    ['DJI Ronin 2', '×1'],
  ];

  return (
    <div aria-hidden className="card hidden overflow-hidden lg:block">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <span className="font-display text-sm font-medium uppercase tracking-[0.08em] text-strong rtl:normal-case rtl:tracking-normal">
          {labels.title}
        </span>
        <span className="size-2 rounded-full bg-brass-500" />
      </div>

      <dl className="grid grid-cols-3 border-b border-line">
        {facts.map((fact, index) => (
          <div key={fact.label} className={`px-5 py-4 ${index > 0 ? 'border-s border-line' : ''}`}>
            <dd className="font-display text-2xl font-semibold tabular-nums text-strong">{fact.value}</dd>
            <dt className="mt-0.5 text-[11px] text-muted">{fact.label}</dt>
          </div>
        ))}
      </dl>

      <div className="px-5 py-4">
        <p className="text-[11px] font-medium text-muted">{labels.package}</p>
        <ul className="mt-2 divide-y divide-line">
          {packageLines.map(([name, qty]) => (
            <li key={name} className="flex items-center justify-between py-2 text-sm" dir="ltr">
              <span className="text-body">{name}</span>
              <span className="font-display tabular-nums text-muted">{qty}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-line bg-surface-sunken px-5 py-4">
        <p className="text-[11px] font-medium text-muted">{labels.budget}</p>
        <div className="mt-2 flex items-end justify-between gap-4">
          <span className="font-display text-2xl font-semibold tabular-nums text-accent">{money(186500)}</span>
          <span className="text-xs tabular-nums text-muted">
            {labels.low} {money(158000)} · {labels.high} {money(221000)}
          </span>
        </div>
      </div>
    </div>
  );
}
