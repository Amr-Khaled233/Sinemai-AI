import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge, Card, EmptyState, SectionTitle } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/utils';
import type { AppLocale } from '@/i18n/routing';

const STATUS_TONE = {
  DRAFT: 'neutral',
  SCRIPT_UPLOADED: 'teal',
  ANALYZING: 'amber',
  READY: 'green',
  FAILED: 'red',
} as const;

export default async function ProducerHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);
  const [t, tEnum, tNav] = await Promise.all([
    getTranslations('project'),
    getTranslations('enum'),
    getTranslations('nav'),
  ]);

  const projects = await prisma.project.findMany({
    where: { ownerId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      type: true,
      budgetTier: true,
      city: true,
      status: true,
      updatedAt: true,
      script: { select: { sceneCount: true, pageCount: true } },
      recommendation: { select: { estimatedBudgetMid: true, currency: true, criticPassed: true } },
    },
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <SectionTitle>{tNav('projects')}</SectionTitle>
        <Link href="/producer/projects/new" className="btn-primary">
          {t('create')}
        </Link>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title={t('empty')}
          action={
            <Link href="/producer/projects/new" className="btn-primary">
              {t('createFirst')}
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/producer/projects/${project.id}`} className="block transition-transform hover:-translate-y-0.5">
                <Card className="h-full hover:border-brass-600/60">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-white">{project.name}</h3>
                    <Badge tone={STATUS_TONE[project.status]}>{t(`status.${project.status}`)}</Badge>
                  </div>

                  <p className="mt-2 flex flex-wrap gap-2 text-xs text-[rgb(var(--muted))]">
                    <span>{tEnum(`type.${project.type}`)}</span>
                    <span>·</span>
                    <span>{tEnum(`tier.${project.budgetTier}`)}</span>
                    <span>·</span>
                    <span>{project.city}</span>
                  </p>

                  <dl className="mt-4 space-y-1 text-xs text-[rgb(var(--muted))]">
                    {project.script && (
                      <div className="flex justify-between">
                        <dt>{t('scenesParsed', { count: project.script.sceneCount })}</dt>
                        <dd>{project.script.pageCount ? t('pages', { count: project.script.pageCount }) : ''}</dd>
                      </div>
                    )}
                    {project.recommendation && (
                      <div className="flex justify-between text-brass-400">
                        <dt>Mid estimate</dt>
                        <dd className="tabular-nums">
                          {formatMoney(
                            project.recommendation.estimatedBudgetMid,
                            locale,
                            project.recommendation.currency,
                          )}
                        </dd>
                      </div>
                    )}
                    <div className="flex justify-between text-[rgb(var(--muted))]/70">
                      <dt>{formatDate(project.updatedAt, locale)}</dt>
                      {project.recommendation && !project.recommendation.criticPassed && (
                        <dd className="text-amber-400">reviewer flags</dd>
                      )}
                    </div>
                  </dl>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
