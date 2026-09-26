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
import { convert, convertSheet } from '@/lib/currency';
import { displayFx } from '@/lib/currency-server';
import { ProductionSheet } from '@/components/sheet/production-sheet';
import { equipmentName } from '@/lib/equipment-name';
import { ProjectChat } from '@/components/producer/project-chat';
import { CHAT_MAX_HISTORY } from '@/lib/project-chat';
import type { UIMessage } from 'ai';
import { cityName } from '@/lib/city-name';
import type { AppLocale } from '@/i18n/routing';

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);
  const [t, tEnum, tSheet, tChat] = await Promise.all([
    getTranslations('project'),
    getTranslations('enum'),
    getTranslations('sheet'),
    getTranslations('chat'),
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

  const [storedTierWindow, settings, storedVersions, catalogRows, chatRows] = await Promise.all([
    getBudgetTierConfig(project.budgetTier),
    getSettings(),
    listVersions(project.id),
    // Only needed when the sheet is editable.
    project.recommendation
      ? prisma.equipment.findMany({
          where: { active: true },
          orderBy: [{ category: { sortOrder: 'asc' } }, { brand: 'asc' }],
          select: { id: true, brand: true, model: true, nameAr: true, category: { select: { slug: true } } },
        })
      : Promise.resolve([]),
    prisma.projectChatMessage.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: CHAT_MAX_HISTORY,
    }),
  ]);
  const chatMessages = chatRows
    .reverse()
    .map((row) => ({ id: row.id, role: row.role, parts: row.parts }) as unknown as UIMessage);
  const hasScript = Boolean(project.script);
  // Everything is stored in SAR; the viewer sees their chosen currency.
  const fx = await displayFx();
  const recommendation = project.recommendation ? convertSheet(project.recommendation, fx) : null;
  const tierWindow = {
    ...storedTierWindow,
    minTotal: convert(storedTierWindow.minTotal, fx),
    maxTotal: convert(storedTierWindow.maxTotal, fx),
    currency: fx.code,
  };
  const versions = storedVersions.map((version) => ({
    ...version,
    estimatedBudgetMid: convert(version.estimatedBudgetMid, fx),
    currency: fx.code,
  }));
  const ready = Boolean(recommendation);
  // A run continues on the server with the page closed, so the client rejoins
  // one that is still moving rather than offering to start a second.
  const inFlight =
    project.analysisState !== null &&
    project.analysisState.stage !== 'DONE' &&
    project.analysisState.stage !== 'FAILED';

  // The upload and run controls lead until there is a sheet, or while a run is
  // in flight; once a sheet exists it is what the page is for, so they follow it.
  const workspaceFirst = !ready || inFlight;
  const workspace = (
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
  );

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="min-w-0 space-y-6">
        {!ready && (
          <header className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-strong">{project.name}</h1>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone="gold">{tEnum(`type.${project.type}`)}</Badge>
                  <Badge>{tEnum(`tier.${project.budgetTier}`)}</Badge>
                  <span>{cityName(project.city, locale)}</span>
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

        {workspaceFirst && workspace}

        {ready && recommendation && (
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
            recommendation={recommendation}
            catalog={catalogRows.map((row) => ({
              id: row.id,
              label: equipmentName(row, locale),
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

        {!workspaceFirst && workspace}

        {ready && <VersionHistory projectId={project.id} versions={versions} locale={locale} />}

        <Card
          title={t('delete')}
          subtitle={t('deleteWarning')}
          className="border-danger/30"
          action={<DeleteProjectButton projectId={project.id} projectName={project.name} />}
        />
      </div>

      {/* The assistant stays in view beside the sheet it edits. */}
      <aside className="card flex flex-col overflow-hidden xl:sticky xl:top-20 xl:order-last xl:h-[calc(100dvh-6.5rem)] max-xl:order-first">
        <header className="border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold text-strong">{tChat('title')}</h2>
          <p className="mt-0.5 text-xs text-muted">{tChat('subtitle')}</p>
        </header>
        <div className="min-h-0 flex-1">
          <ProjectChat projectId={project.id} initialMessages={chatMessages} hasSheet={ready} />
        </div>
      </aside>
    </div>
  );
}
