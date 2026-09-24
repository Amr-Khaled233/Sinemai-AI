import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { mayReadProject } from '@/lib/authz';
import { loadComparison } from '@/lib/versions';
import { VersionComparison } from '@/components/sheet/version-compare';
import type { AppLocale } from '@/i18n/routing';

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string; id: string; version: string }>;
}) {
  const { locale, id, version } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, ownerId: true },
  });
  if (!project) notFound();
  if (!mayReadProject(project, session.user)) notFound();

  const versionNumber = Number(version);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) notFound();

  const [t, comparison] = await Promise.all([
    getTranslations('versions'),
    loadComparison(id, versionNumber),
  ]);
  if (!comparison) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">{t('title')}</p>
          <h1 className="mt-2 text-xl font-semibold text-strong">{project.name}</h1>
        </div>
        <Link href={`/producer/projects/${id}`} className="btn-secondary text-xs">
          {t('backToSheet')}
        </Link>
      </div>

      <VersionComparison comparison={comparison} locale={locale} />
    </div>
  );
}
