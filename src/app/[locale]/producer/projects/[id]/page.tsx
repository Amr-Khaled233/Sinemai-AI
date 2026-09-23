import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getBudgetTierConfig } from '@/lib/settings';
import { Badge, Card, Stat } from '@/components/ui';
import { ScriptUpload } from '@/components/producer/script-upload';
import { AnalysisRunner } from '@/components/producer/analysis-runner';
import { ShareControls } from '@/components/sheet/share-controls';
import { ProductionSheet } from '@/components/sheet/production-sheet';
import type { AppLocale } from '@/i18n/routing';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);
  const [t, tEnum, tSheet] = await Promise.all([
    getTranslations('project'),
    getTranslations('enum'),
    getTranslations('sheet'),
  ]);

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      script: {
        select: {
          fileName: true,
          parsedFormat: true,
          sceneCount: true,
          pageCount: true,
          scenes: {
            orderBy: { order: 'asc' },
            select: {
              order: true,
              heading: true,
              intExt: true,
              timeOfDay: true,
              lightingComplexity: true,
              lightingNotes: true,
              cameraMovement: true,
              specialRequirements: true,
              estimatedHours: true,
            },
          },
        },
      },
      recommendation: true,
      shareLinks: { where: { revoked: false }, select: { token: true }, take: 1 },
    },
  });

  if (!project) notFound();
  if (project.ownerId !== session.user.id && session.user.role !== 'ADMIN') notFound();

  const tierWindow = await getBudgetTierConfig(project.budgetTier);
  const hasScript = Boolean(project.script);
  const ready = Boolean(project.recommendation);

  return (
    <div className="space-y-6">
      {!ready && (
        <header className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-white">{project.name}</h1>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted))]">
                <Badge tone="gold">{tEnum(`type.${project.type}`)}</Badge>
                <Badge>{tEnum(`tier.${project.budgetTier}`)}</Badge>
                <span>{project.city}</span>
                <Badge tone={project.status === 'FAILED' ? 'red' : 'teal'}>
                  {t(`status.${project.status}`)}
                </Badge>
              </p>
              {project.visualStyleTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {project.visualStyleTags.map((tag) => (
                    <span key={tag} className="chip text-[11px]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title={t('scriptTitle')}
          subtitle={
            project.script
              ? [
                  project.script.fileName ?? project.script.parsedFormat,
                  t('scenesParsed', { count: project.script.sceneCount }),
                  project.script.pageCount ? t('pages', { count: project.script.pageCount }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : t('noScript')
          }
        >
          <ScriptUpload projectId={project.id} hasScript={hasScript} />
        </Card>

        <Card title={t('analyze')}>
          {hasScript ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <Stat label={tSheet('scenes')} value={project.script!.sceneCount} />
                <Stat label={tSheet('pages')} value={project.script!.pageCount ?? '—'} />
              </div>
              <AnalysisRunner
                projectId={project.id}
                label={ready ? t('reanalyze') : t('analyze')}
                disabled={!hasScript}
              />
            </>
          ) : (
            <p className="prose-sheet">{t('noScript')}</p>
          )}
        </Card>
      </div>

      {ready && project.recommendation && (
        <ProductionSheet
          locale={locale}
          project={{
            id: project.id,
            name: project.name,
            type: project.type,
            budgetTier: project.budgetTier,
            city: project.city,
            visualStyleTags: project.visualStyleTags,
          }}
          recommendation={project.recommendation}
          scenes={project.script?.scenes ?? []}
          tierWindow={tierWindow}
          actions={
            <ShareControls
              projectId={project.id}
              locale={locale}
              existingToken={project.shareLinks[0]?.token ?? null}
            />
          }
        />
      )}
    </div>
  );
}
