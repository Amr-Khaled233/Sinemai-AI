import { getTranslations } from 'next-intl/server';
import type { BudgetTier, Prisma } from '@prisma/client';
import { Badge, Card, MeterBar, Stat } from '@/components/ui';
import { MeterFill, Reveal } from '@/components/motion';
import { InquiryButton } from '@/components/sheet/inquiry-form';
import { formatDate, formatMoney, truncate } from '@/lib/utils';
import type {
  BudgetBreakdown,
  DopMatch,
  PackageItem,
  SceneSummary,
  VendorMatch,
} from '@/agents/types';

export type SheetProject = {
  id: string;
  name: string;
  type: string;
  budgetTier: BudgetTier;
  city: string;
  visualStyleTags: string[];
};

export type SheetRecommendation = {
  equipmentPackage: Prisma.JsonValue;
  equipmentRationale: string;
  matchedDops: Prisma.JsonValue;
  matchedVendors: Prisma.JsonValue;
  estimatedBudgetLow: number;
  estimatedBudgetMid: number;
  estimatedBudgetHigh: number;
  currency: string;
  budgetBreakdown: Prisma.JsonValue;
  sceneSummary: Prisma.JsonValue;
  rationaleText: string;
  criticNotes: string[];
  criticPassed: boolean;
  modelVersions: Prisma.JsonValue;
  generatedAt: Date;
};

export type SheetScene = {
  order: number;
  heading: string;
  intExt: string | null;
  timeOfDay: string | null;
  lightingComplexity: string | null;
  lightingNotes: string | null;
  cameraMovement: string | null;
  specialRequirements: string[];
  estimatedHours: number | null;
};

type BudgetExtras = BudgetBreakdown & {
  notes?: string[];
  uncoveredEquipment?: Array<{ equipmentId: string; brand: string; model: string; fallbackDayRate: number | null }>;
};

const CATEGORY_LABELS: Record<string, { en: string; ar: string }> = {
  'camera-body': { en: 'Camera', ar: 'كاميرا' },
  lens: { en: 'Lens', ar: 'عدسات' },
  lighting: { en: 'Lighting', ar: 'إضاءة' },
  grip: { en: 'Grip', ar: 'تثبيت' },
  support: { en: 'Support', ar: 'حركة' },
  sound: { en: 'Sound', ar: 'صوت' },
  power: { en: 'Power', ar: 'طاقة' },
};

export async function ProductionSheet({
  locale,
  project,
  recommendation,
  scenes,
  tierWindow,
  readOnly = false,
  actions,
}: {
  locale: string;
  project: SheetProject;
  recommendation: SheetRecommendation;
  scenes: SheetScene[];
  tierWindow: { minTotal: number; maxTotal: number; currency: string };
  readOnly?: boolean;
  actions?: React.ReactNode;
}) {
  const [t, tEnum] = await Promise.all([getTranslations('sheet'), getTranslations('enum')]);

  const pkg = (recommendation.equipmentPackage as unknown as PackageItem[]) ?? [];
  const dops = (recommendation.matchedDops as unknown as DopMatch[]) ?? [];
  const vendors = (recommendation.matchedVendors as unknown as VendorMatch[]) ?? [];
  const budget = (recommendation.budgetBreakdown as unknown as BudgetExtras) ?? null;
  const summary = (recommendation.sceneSummary as unknown as SceneSummary) ?? null;
  const models = Object.values((recommendation.modelVersions as Record<string, string>) ?? {});
  const money = (value: number) => formatMoney(value, locale, recommendation.currency);
  const categoryLabel = (slug: string) =>
    locale === 'ar' ? CATEGORY_LABELS[slug]?.ar ?? slug : CATEGORY_LABELS[slug]?.en ?? slug;

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- header */}
      <header className="card relative overflow-hidden p-5 sm:p-7">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent"
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{t('title')}</p>
            <h1 className="mt-2 text-2xl font-semibold text-strong sm:text-3xl">{project.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone="gold">{tEnum(`type.${project.type}`)}</Badge>
              <Badge>{tEnum(`tier.${project.budgetTier}`)}</Badge>
              <span>{project.city}</span>
              <span>·</span>
              <span>{t('generated', { date: formatDate(recommendation.generatedAt, locale) })}</span>
              {readOnly && <Badge tone="teal">{t('readOnly')}</Badge>}
            </p>
            <p className="mt-2 text-xs text-muted/80">
              {t('tierWindow', { min: money(tierWindow.minTotal), max: money(tierWindow.maxTotal) })}
            </p>
          </div>
          {actions}
        </div>

        {recommendation.rationaleText && (
          <div className="mt-5 border-t border-line/70 pt-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('summary')}
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-7 text-body/90">
              {recommendation.rationaleText}
            </p>
          </div>
        )}
      </header>

      {/* ---------------------------------------------------------- reviewer */}
      <Card
        title={t('reviewer')}
        action={
          recommendation.criticPassed ? (
            <Badge tone="green">OK</Badge>
          ) : (
            <Badge tone="red">{tEnum('severity.blocker')}</Badge>
          )
        }
      >
        {recommendation.criticNotes.length === 0 ? (
          <p className="prose-sheet">{t('reviewerClean')}</p>
        ) : (
          <ul className="space-y-2">
            {recommendation.criticNotes.map((note, index) => {
              const severity = /^\[(\w+)\]/.exec(note)?.[1] ?? 'info';
              const tone = severity === 'blocker' ? 'red' : severity === 'warning' ? 'amber' : 'neutral';
              return (
                <li key={index} className="flex gap-2 text-sm leading-6 text-muted">
                  <Badge tone={tone as 'red' | 'amber' | 'neutral'}>{tEnum(`severity.${severity}`)}</Badge>
                  <span>{note.replace(/^\[\w+\]\s*/, '')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------- scenes */}
      {summary && (
        <Card title={t('sceneBreakdown')}>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={t('scenes')} value={summary.sceneCount} />
            <Stat label={t('shootDays')} value={summary.shootDays} />
            <Stat label={t('totalHours')} value={summary.totalHours} />
            <Stat label={t('nightScenes')} value={`${summary.nightScenePct}%`} />
            <Stat label={t('exteriors')} value={`${summary.exteriorScenePct}%`} />
            <Stat label={t('highComplexity')} value={`${summary.highComplexityPct}%`} />
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="label">{t('lighting')}</p>
              <MeterBar
                segments={[
                  { label: tEnum('complexity.LOW'), value: summary.lightingMix.LOW, className: 'bg-info' },
                  { label: tEnum('complexity.MEDIUM'), value: summary.lightingMix.MEDIUM, className: 'bg-brass-500' },
                  { label: tEnum('complexity.HIGH'), value: summary.lightingMix.HIGH, className: 'bg-danger' },
                ]}
              />
            </div>
            <div>
              <p className="label">{t('movement')}</p>
              <MeterBar
                segments={[
                  { label: tEnum('movement.STATIC'), value: summary.movementMix.STATIC, className: 'bg-line-strong' },
                  { label: tEnum('movement.HANDHELD'), value: summary.movementMix.HANDHELD, className: 'bg-info' },
                  {
                    label: tEnum('movement.STEADICAM_GIMBAL'),
                    value: summary.movementMix.STEADICAM_GIMBAL,
                    className: 'bg-brass-500',
                  },
                  {
                    label: tEnum('movement.CRANE_DOLLY'),
                    value: summary.movementMix.CRANE_DOLLY,
                    className: 'bg-warning',
                  },
                  { label: tEnum('movement.DRONE'), value: summary.movementMix.DRONE, className: 'bg-danger' },
                ]}
              />
            </div>
          </div>

          <div className="table-wrap mt-5">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10">{t('sceneNumber')}</th>
                  <th>{t('heading')}</th>
                  <th>{t('environment')}</th>
                  <th>{t('time')}</th>
                  <th>{t('lighting')}</th>
                  <th>{t('movement')}</th>
                  <th className="text-end">{t('hours')}</th>
                  <th>{t('special')}</th>
                </tr>
              </thead>
              <tbody>
                {scenes.map((scene) => (
                  <tr key={scene.order}>
                    <td className="tabular-nums text-muted">{scene.order}</td>
                    <td className="max-w-[18rem] text-strong">
                      <div className="truncate font-medium">{truncate(scene.heading, 70)}</div>
                      {scene.lightingNotes && (
                        <div className="mt-0.5 text-xs text-muted">{scene.lightingNotes}</div>
                      )}
                    </td>
                    <td>{scene.intExt ? tEnum(`intExt.${scene.intExt}`) : '—'}</td>
                    <td>{scene.timeOfDay ? tEnum(`time.${scene.timeOfDay}`) : '—'}</td>
                    <td>
                      {scene.lightingComplexity ? (
                        <Badge
                          tone={
                            scene.lightingComplexity === 'HIGH'
                              ? 'red'
                              : scene.lightingComplexity === 'MEDIUM'
                                ? 'amber'
                                : 'teal'
                          }
                        >
                          {tEnum(`complexity.${scene.lightingComplexity}`)}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{scene.cameraMovement ? tEnum(`movement.${scene.cameraMovement}`) : '—'}</td>
                    <td className="text-end tabular-nums">{scene.estimatedHours ?? '—'}</td>
                    <td className="text-xs text-muted">
                      {scene.specialRequirements.length ? scene.specialRequirements.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---------------------------------------------------------- equipment */}
      <Card title={t('equipmentTitle')}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('category')}</th>
                <th>{t('item')}</th>
                <th className="w-16 text-end">{t('quantity')}</th>
                <th className="w-16 text-end">{t('days')}</th>
                <th>{t('reason')}</th>
              </tr>
            </thead>
            <tbody>
              {pkg.map((item) => (
                <tr key={item.equipmentId}>
                  <td className="text-xs uppercase tracking-wider text-accent">
                    {categoryLabel(item.categorySlug)}
                  </td>
                  <td className="font-medium text-strong">
                    {item.brand} {item.model}
                  </td>
                  <td className="text-end tabular-nums">{item.quantity}</td>
                  <td className="text-end tabular-nums">{item.rentalDays}</td>
                  <td className="text-muted">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {recommendation.equipmentRationale && (
          <div className="mt-4 rounded-lg border border-line/60 bg-surface-sunken p-4">
            <p className="label">{t('equipmentRationale')}</p>
            <p className="prose-sheet">{recommendation.equipmentRationale}</p>
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------------- DOPs */}
      <Card title={t('dopsTitle')}>
        {dops.length === 0 ? (
          <p className="prose-sheet">{t('dopsEmpty')}</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {dops.map((dop) => (
              <li
                key={dop.dopId}
                className="card card-interactive bg-surface-sunken/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-strong">{dop.name}</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      {[dop.city, dop.yearsExperience ? t('years', { count: dop.yearsExperience }) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="text-end">
                    <div className="text-xs text-muted">{t('matchScore')}</div>
                    <div className="text-lg font-semibold tabular-nums text-accent">
                      {Math.round(dop.score * 100)}%
                    </div>
                  </div>
                </div>

                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line/70">
                  <MeterFill
                    pct={Math.min(100, Math.max(4, dop.score * 100))}
                    className="bg-gradient-to-r from-brass-600 to-brass-400"
                  />
                </div>

                <p className="mt-3 text-sm leading-6 text-muted">{dop.reason}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {dop.styleTags.slice(0, 5).map((tag) => (
                    <span key={tag} className="chip text-[11px]">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                  {dop.portfolioLinks.slice(0, 3).map((link) => (
                    <a
                      key={link}
                      href={link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-info hover:underline"
                    >
                      {t('portfolio')} ↗
                    </a>
                  ))}
                  {dop.dayRate ? (
                    <span className="text-muted">
                      {t('dayRate')}: {money(dop.dayRate)}
                    </span>
                  ) : null}
                  {!readOnly && (
                    <InquiryButton
                      className="ms-auto"
                      projectId={project.id}
                      projectName={project.name}
                      targetType="DOP"
                      targetId={dop.dopId}
                      targetName={dop.name}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------- vendors */}
      <Card title={t('vendorsTitle')}>
        {vendors.length === 0 ? (
          <p className="prose-sheet">{t('vendorsEmpty')}</p>
        ) : (
          <div className="space-y-4">
            {vendors.map((vendor) => (
              <div key={vendor.vendorId} className="card bg-surface-sunken/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-strong">
                      {vendor.companyName}
                      {vendor.verified && <Badge tone="teal">✓</Badge>}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted">
                      {vendor.city} · {t('coverage')} {vendor.coveragePct}%
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-end">
                      <div className="text-xs text-muted">{t('subtotal')}</div>
                      <div className="font-semibold tabular-nums text-strong">{money(vendor.subtotal)}</div>
                    </div>
                    {!readOnly && (
                      <InquiryButton
                        projectId={project.id}
                        projectName={project.name}
                        targetType="VENDOR"
                        targetId={vendor.vendorId}
                        targetName={vendor.companyName}
                      />
                    )}
                  </div>
                </div>

                <div className="table-wrap mt-3">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t('item')}</th>
                        <th className="w-14 text-end">{t('quantity')}</th>
                        <th className="w-14 text-end">{t('days')}</th>
                        <th className="text-end">{t('rate')}</th>
                        <th className="text-end">{t('total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendor.items.map((line) => (
                        <tr key={line.equipmentId}>
                          <td className="text-strong">
                            {line.brand} {line.model}
                            {!line.available && (
                              <span className="ms-2 text-[11px] text-warning">{t('unavailableOnDates')}</span>
                            )}
                          </td>
                          <td className="text-end tabular-nums">{line.quantity}</td>
                          <td className="text-end tabular-nums">{line.rentalDays}</td>
                          <td className="text-end tabular-nums">{money(line.dailyRate)}</td>
                          <td className="text-end tabular-nums text-strong">{money(line.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {budget?.uncoveredEquipment && budget.uncoveredEquipment.length > 0 && (
          <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            {t('uncovered')}:{' '}
            {budget.uncoveredEquipment.map((item) => `${item.brand} ${item.model}`).join(' · ')}
          </p>
        )}
      </Card>

      {/* ---------------------------------------------------------- budget */}
      {budget && (
        <Card title={t('budgetTitle')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t('budgetLow')} value={money(recommendation.estimatedBudgetLow)} />
            <Stat label={t('budgetMid')} value={money(recommendation.estimatedBudgetMid)} />
            <Stat label={t('budgetHigh')} value={money(recommendation.estimatedBudgetHigh)} />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <p className="label">{t('crew')}</p>
              <div className="table-wrap">
                <table className="table min-w-0">
                  <thead>
                    <tr>
                      <th>{t('role')}</th>
                      <th className="w-10 text-end">{t('headcount')}</th>
                      <th className="text-end">{t('rate')}</th>
                      <th className="w-12 text-end">{t('days')}</th>
                      <th className="text-end">{t('total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budget.crewBreakdown.map((line) => (
                      <tr key={line.roleSlug}>
                        <td className="text-strong">{locale === 'ar' ? line.labelAr : line.labelEn}</td>
                        <td className="text-end tabular-nums">{line.headcount}</td>
                        <td className="text-end tabular-nums">{money(line.dayRate)}</td>
                        <td className="text-end tabular-nums">{line.days}</td>
                        <td className="text-end tabular-nums text-strong">{money(line.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <p className="label">{t('total')}</p>
              <dl className="space-y-2.5 rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/[0.08] to-transparent p-5 text-sm">
                <Row label={t('equipmentRental')} value={money(budget.equipmentRental)} />
                <Row label={t('crew')} value={money(budget.crewTotal)} />
                <Row
                  label={t('contingency', { pct: budget.contingencyPct })}
                  value={money(Math.max(0, budget.contingency))}
                />
                <div className="border-t border-line pt-2">
                  <Row label={t('budgetMid')} value={money(recommendation.estimatedBudgetMid)} strong />
                </div>
                <Row label={t('shootDays')} value={String(budget.shootDays)} />
              </dl>

              {budget.notes && budget.notes.length > 0 && (
                <div className="mt-4">
                  <p className="label">{t('notes')}</p>
                  <ul className="space-y-1.5 text-sm text-muted">
                    {budget.notes.map((note, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="text-accent">·</span>
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <p className="px-1 text-[11px] leading-6 text-muted/60">
        {t('provenance', { models: models.length ? [...new Set(models)].join(', ') : 'gpt-4o' })}
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? 'text-base font-semibold tabular-nums text-accent' : 'tabular-nums text-strong'}>
        {value}
      </dd>
    </div>
  );
}
