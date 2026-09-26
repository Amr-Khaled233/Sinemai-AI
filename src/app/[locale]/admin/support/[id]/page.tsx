import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { openThread } from '@/lib/support';
import { ThreadView } from '@/components/support/support-views';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminSupportThreadPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale as AppLocale);
  const session = await requireRole('ADMIN', locale);

  const thread = await openThread(id, { id: session.user.id, isAdmin: true });
  if (!thread) notFound();

  return <ThreadView thread={thread} viewerIsAdmin backHref="/admin/support" locale={locale} />;
}
