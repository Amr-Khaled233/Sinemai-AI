import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { isAuthorizedJob } from '@/lib/cron';
import { buildDopEmbeddingText, embedText, findStaleDops, writeDopEmbedding } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Nightly: (re)generate style vectors for approved cinematographers whose
 * profile changed after their last embedding. Batched so one run stays inside
 * the function duration; the next run picks up whatever is left.
 */
export async function GET(request: Request) {
  const session = await auth();
  const allowed = isAuthorizedJob(request) || session?.user?.role === 'ADMIN';
  if (!allowed) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'NO_OPENAI_KEY' }, { status: 503 });
  }

  const stale = await findStaleDops(25);
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  for (const dop of stale) {
    try {
      const text = buildDopEmbeddingText(dop);
      const vector = await embedText(text);
      await writeDopEmbedding(dop.id, text, vector);
      results.push({ id: dop.id, ok: true });
    } catch (error) {
      results.push({ id: dop.id, ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' });
    }
  }

  const remaining = await prisma.dop.count({
    where: { status: 'APPROVED', embeddedAt: null },
  });

  return NextResponse.json({
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    remainingWithoutEmbedding: remaining,
    results,
  });
}

export const POST = GET;
