import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { openThread } from '@/lib/support';
import { ThreadView } from '@/components/support/support-views';
import type { AppLocale } from '@/i18n/routing';

export default async function UserSupportThreadPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as AppLocale);
  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);

  // A user only ever opens their own threads here, even the admin.
  const thread = await openThread(id, { id: session.user.id, isAdmin: false });
  if (!thread) notFound();

  return <ThreadView thread={thread} viewerIsAdmin={false} backHref="/producer/support" locale={locale} />;
}
