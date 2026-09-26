import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { UIMessage } from 'ai';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { mayReadProject } from '@/lib/authz';
import { sheetScenesArg } from '@/lib/sheet-query';
import { getBudgetTierConfig, getSettings } from '@/lib/settings';
import { Badge, Card } from '@/components/ui';
import { ScriptUpload } from '@/components/producer/script-upload';
import { AnalysisRunner } from '@/components/producer/analysis-runner';
import { ShareControls } from '@/components/sheet/share-controls';
import { DeleteProjectButton } from '@/components/producer/danger-zone';
import { VersionHistory } from '@/components/sheet/version-compare';
import { ProductionSheet } from '@/components/sheet/production-sheet';
import { ProjectChat } from '@/components/producer/project-chat';
import { listVersions } from '@/lib/versions';
import { convert, convertSheet } from '@/lib/currency';
import { displayFx } from '@/lib/currency-server';
import { CHAT_MAX_HISTORY } from '@/lib/project-chat';
import { equipmentName } from '@/lib/equipment-name';
import { cityName } from '@/lib/city-name';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/i18n/routing';

function loadProject(id: string) {
  return prisma.project.findUnique({
    where: { id },
    include: {
      script: {
        select: { fileName: true, parsedFormat: true, sceneCount: true, pageCount: true, scenes: sheetScenesArg },
      },
      recommendation: true,
      analysisState: { select: { stage: true } },
      shareLinks: { where: { revoked: false }, select: { token: true }, take: 1 },
    },
  });
}

type LoadedProject = NonNullable<Awaited<ReturnType<typeof loadProject>>>;

/**
 * One script. The Assistant tab is where the user works: the analysis runs
 * there, then the assistant lays out what the script needs, the alternatives
 * and where to save, and takes changes. The Sheet tab is the full document —
 * every table, the exports, the history.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ tab?: string; start?: string }>;
}) {
  const { locale, id } = await params;
  const { tab, start } = await searchParams;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);
  const [t, tEnum, tChat, project] = await Promise.all([
    getTranslations('project'),
    getTranslations('enum'),
    getTranslations('chat'),
    loadProject(id),
  ]);

  if (!project) notFound();
  if (!mayReadProject(project, session.user)) notFound();

  const hasScript = Boolean(project.script);
  const ready = Boolean(project.recommendation);
  // A run continues on the server with the page closed, so the client rejoins
  // one that is still moving rather than offering to start a second.
  const inFlight =
    project.analysisState !== null &&
    project.analysisState.stage !== 'DONE' &&
    project.analysisState.stage !== 'FAILED';
  const showSheet = tab === 'sheet' && ready;

  const chatRows = await prisma.projectChatMessage.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    take: CHAT_MAX_HISTORY,
  });
  const chatMessages = chatRows
    .reverse()
    .map((row) => ({ id: row.id, role: row.role, parts: row.parts }) as unknown as UIMessage);

  const tabs = [
    { key: 'assistant', href: `/producer/projects/${project.id}`, label: tChat('title'), active: !showSheet },
    ...(ready
      ? [{ key: 'sheet', href: `/producer/projects/${project.id}?tab=sheet`, label: t('fullSheet'), active: showSheet }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <header className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href="/producer" className="tap-link text-xs text-muted hover:text-accent">
              ← {t('myScripts')}
            </Link>
            <h1 className="mt-2 text-xl font-semibold text-strong" dir="auto">
              {project.name}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone="gold">{tEnum(`type.${project.type}`)}</Badge>
              <Badge>{tEnum(`tier.${project.budgetTier}`)}</Badge>
              <span>{cityName(project.city, locale)}</span>
              {project.script && (
                <>
                  <span>·</span>
                  <span>{t('scenesParsed', { count: project.script.sceneCount })}</span>
                </>
              )}
            </p>
          </div>
          <nav className="flex gap-1 rounded-full border border-line p-1" aria-label={t('views')}>
            {tabs.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={item.active ? 'page' : undefined}
                className={cn(
                  'rounded-full px-4 py-1.5 font-display text-xs font-medium uppercase tracking-wider transition-colors rtl:tracking-normal',
                  item.active ? 'bg-brass-500 text-ink-950' : 'text-muted hover:text-strong',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {showSheet ? (
        <SheetTab project={project} locale={locale} />
      ) : (
        <div className="space-y-6">
          {/* Until there is a sheet, the analysis leads; it starts on its own for a new script. */}
          {(!ready || inFlight) && (
            <Card title={t('analyze')}>
              {hasScript ? (
                <AnalysisRunner
                  projectId={project.id}
                  label={ready ? t('reanalyze') : t('analyze')}
                  inFlight={inFlight}
                  autoStart={start === '1' && !ready}
                />
              ) : (
                <ScriptUpload projectId={project.id} hasScript={false} />
              )}
            </Card>
          )}

          <section className="card overflow-hidden">
            <ProjectChat
              projectId={project.id}
              initialMessages={chatMessages}
              hasSheet={ready && !inFlight}
              className="h-[calc(100dvh-16rem)] min-h-[30rem]"
            />
          </section>
        </div>
      )}
    </div>
  );
}

/** The full sheet and everything around it: exports, history, script, deletion. */
async function SheetTab({ project, locale }: { project: LoadedProject; locale: string }) {
  const t = await getTranslations('project');
  const [storedTierWindow, settings, storedVersions, catalogRows, fx] = await Promise.all([
    getBudgetTierConfig(project.budgetTier),
    getSettings(),
    listVersions(project.id),
    prisma.equipment.findMany({
      where: { active: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { brand: 'asc' }],
      select: { id: true, brand: true, model: true, nameAr: true, category: { select: { slug: true } } },
    }),
    // Everything is stored in SAR; the viewer sees their chosen currency.
    displayFx(),
  ]);

  const recommendation = convertSheet(project.recommendation!, fx);
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

  return (
    <div className="space-y-6">
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
          <ShareControls projectId={project.id} locale={locale} existingToken={project.shareLinks[0]?.token ?? null} />
        }
      />

      <VersionHistory projectId={project.id} versions={versions} locale={locale} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('scriptTitle')} subtitle={project.script?.fileName ?? undefined}>
          <ScriptUpload projectId={project.id} hasScript />
          <div className="mt-5 border-t border-line pt-5">
            <AnalysisRunner projectId={project.id} label={t('reanalyze')} />
          </div>
        </Card>
        <Card
          title={t('delete')}
          subtitle={t('deleteWarning')}
          className="border-danger/30"
          action={<DeleteProjectButton projectId={project.id} projectName={project.name} />}
        />
      </div>
    </div>
  );
}
