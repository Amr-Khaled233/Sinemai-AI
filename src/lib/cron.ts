import { constantTimeEqual } from '@/lib/compare';

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The same guard lets an
 * admin trigger a job by hand, and lets a queue (Upstash QStash or similar) call
 * these routes if the work ever outgrows a single cron invocation.
 */
export function isAuthorizedJob(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  const header = request.headers.get('authorization') ?? '';
  return constantTimeEqual(header, `Bearer ${secret}`);
}
