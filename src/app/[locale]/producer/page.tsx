import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge, Card, EmptyState, SectionTitle } from '@/components/ui';
import { Reveal } from '@/components/motion';
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
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
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
          {projects.map((project, index) => (
            <Reveal as="li" key={project.id} delay={index * 60}>
              <Link href={`/producer/projects/${project.id}`} className="block h-full">
                <Card interactive className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-strong">{project.name}</h3>
                    <Badge tone={STATUS_TONE[project.status]} pulse={project.status === 'ANALYZING'}>
                      {t(`status.${project.status}`)}
                    </Badge>
                  </div>

                  <p className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    <span>{tEnum(`type.${project.type}`)}</span>
                    <span>·</span>
                    <span>{tEnum(`tier.${project.budgetTier}`)}</span>
                    <span>·</span>
                    <span>{project.city}</span>
                  </p>

                  <dl className="mt-4 space-y-1 text-xs text-muted">
                    {project.script && (
                      <div className="flex justify-between">
                        <dt>{t('scenesParsed', { count: project.script.sceneCount })}</dt>
                        <dd>{project.script.pageCount ? t('pages', { count: project.script.pageCount }) : ''}</dd>
                      </div>
                    )}
                    {project.recommendation && (
                      <div className="flex justify-between text-accent">
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
                    <div className="flex justify-between text-muted/70">
                      <dt>{formatDate(project.updatedAt, locale)}</dt>
                      {project.recommendation && !project.recommendation.criticPassed && (
                        <dd className="text-warning">reviewer flags</dd>
                      )}
                    </div>
                  </dl>
                </Card>
              </Link>
            </Reveal>
          ))}
        </ul>
      )}
    </div>
  );
}
