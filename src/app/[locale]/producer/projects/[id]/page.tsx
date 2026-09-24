import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { mayReadProject } from '@/lib/authz';
import { sheetScenesArg } from '@/lib/sheet-query';
import { getBudgetTierConfig, getSettings } from '@/lib/settings';
import { Badge, Card, Stat } from '@/components/ui';
import { ScriptUpload } from '@/components/producer/script-upload';
import { AnalysisRunner } from '@/components/producer/analysis-runner';
import { ShareControls } from '@/components/sheet/share-controls';
import { DeleteProjectButton } from '@/components/producer/danger-zone';
import { VersionHistory } from '@/components/sheet/version-compare';
import { listVersions } from '@/lib/versions';
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
          scenes: sheetScenesArg,
        },
      },
      recommendation: true,
      analysisState: { select: { stage: true } },
      shareLinks: { where: { revoked: false }, select: { token: true }, take: 1 },
    },
  });

  if (!project) notFound();
  if (!mayReadProject(project, session.user)) notFound();

  const [tierWindow, settings, versions, catalogRows] = await Promise.all([
    getBudgetTierConfig(project.budgetTier),
    getSettings(),
    listVersions(project.id),
    // Only needed when the sheet is editable.
    project.recommendation
      ? prisma.equipment.findMany({
          where: { active: true },
          orderBy: [{ category: { sortOrder: 'asc' } }, { brand: 'asc' }],
          select: { id: true, brand: true, model: true, category: { select: { slug: true } } },
        })
      : Promise.resolve([]),
  ]);
  const hasScript = Boolean(project.script);
  const ready = Boolean(project.recommendation);
  // A run continues on the server with the page closed, so the client rejoins
  // one that is still moving rather than offering to start a second.
  const inFlight =
    project.analysisState !== null &&
    project.analysisState.stage !== 'DONE' &&
    project.analysisState.stage !== 'FAILED';

  return (
    <div className="space-y-6">
      {!ready && (
        <header className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-strong">{project.name}</h1>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
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
                inFlight={inFlight}
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
          catalog={catalogRows.map((row) => ({
            id: row.id,
            label: `${row.brand} ${row.model}`,
            categorySlug: row.category.slug,
          }))}
          scenes={project.script?.scenes ?? []}
          tierWindow={tierWindow}
      shootDayHours={settings.shootDayHours}
          actions={
            <ShareControls
              projectId={project.id}
              locale={locale}
              existingToken={project.shareLinks[0]?.token ?? null}
            />
          }
        />
      )}

      {ready && <VersionHistory projectId={project.id} versions={versions} locale={locale} />}

      <Card
        title={t('delete')}
        subtitle={t('deleteWarning')}
        className="border-danger/30"
        action={<DeleteProjectButton projectId={project.id} projectName={project.name} />}
      />
    </div>
  );
}
