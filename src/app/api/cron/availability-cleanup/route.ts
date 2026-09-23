import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { isAuthorizedJob } from '@/lib/cron';

export const runtime = 'nodejs';

/** Nightly: drop availability blocks that ended more than 30 days ago. */
export async function GET(request: Request) {
  const session = await auth();
  const allowed = isAuthorizedJob(request) || session?.user?.role === 'ADMIN';
  if (!allowed) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const { count } = await prisma.availabilityBlock.deleteMany({ where: { endDate: { lt: cutoff } } });

  // Projects that were left mid-analysis by a crashed or timed-out function.
  const stuck = await prisma.project.updateMany({
    where: { status: 'ANALYZING', updatedAt: { lt: new Date(Date.now() - 2 * 3_600_000) } },
    data: { status: 'FAILED' },
  });

  return NextResponse.json({ blocksRemoved: count, staleAnalysesFailed: stuck.count });
}

export const POST = GET;
