import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * DOP style vectors.
 *
 * text-embedding-3-large is shortened to 1536 dimensions via the provider's
 * `dimensions` parameter: pgvector's HNSW index tops out at 2000 dims, and the
 * shortened vectors keep nearly all of the retrieval quality.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-large';
export const EMBEDDING_DIMENSIONS = 1536;

export async function embedText(text: string): Promise<number[]> {
  const input = text.trim().slice(0, 8000);
  if (!input) throw new Error('embedText: empty input');
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: input,
    providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } },
  });
  return embedding;
}

function toVectorLiteral(vector: number[]) {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dims, received ${vector.length}`);
  }
  return `[${vector.map((v) => (Number.isFinite(v) ? v.toFixed(7) : '0')).join(',')}]`;
}

/**
 * The text a DOP profile is embedded from. Style tags are repeated because they
 * are the strongest matching signal and the bio is free-form marketing prose.
 */
export function buildDopEmbeddingText(dop: {
  displayName: string;
  bio: string;
  styleTags: string[];
  city?: string | null;
  yearsExperience?: number | null;
}) {
  const tags = dop.styleTags.join(', ');
  return [
    `Cinematographer style profile.`,
    `Visual style tags: ${tags || 'unspecified'}.`,
    `Signature look: ${tags || 'unspecified'}.`,
    dop.city ? `Based in ${dop.city}.` : '',
    dop.yearsExperience ? `${dop.yearsExperience} years of experience.` : '',
    `Biography: ${dop.bio}`,
  ]
    .filter(Boolean)
    .join(' ');
}

export async function writeDopEmbedding(dopId: string, text: string, vector: number[]) {
  await prisma.$executeRaw`
    UPDATE "Dop"
    SET embedding = ${toVectorLiteral(vector)}::vector,
        "embeddingText" = ${text},
        "embeddedAt" = NOW()
    WHERE id = ${dopId}`;
}

export type DopSearchHit = {
  id: string;
  displayName: string;
  displayNameAr: string | null;
  city: string | null;
  bio: string;
  styleTags: string[];
  portfolioLinks: string[];
  dayRate: number | null;
  yearsExperience: number | null;
  reelThumbUrl: string | null;
  score: number;
};

/**
 * Cosine-similarity search over the pgvector column. `1 - (a <=> b)` turns
 * pgvector's cosine distance into a 0..1 similarity score.
 */
export async function vectorSearchDops(
  vector: number[],
  topN: number,
  opts: { city?: string | null } = {},
): Promise<DopSearchHit[]> {
  const literal = toVectorLiteral(vector);
  const limit = Math.min(Math.max(topN, 1), 20);

  const rows = await prisma.$queryRaw<Array<DopSearchHit & { score: number }>>(Prisma.sql`
    SELECT id,
           "displayName",
           "displayNameAr",
           city,
           bio,
           "styleTags",
           "portfolioLinks",
           "dayRate",
           "yearsExperience",
           "reelThumbUrl",
           1 - (embedding <=> ${literal}::vector) AS score
    FROM "Dop"
    WHERE status = 'APPROVED'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}`);

  // Proximity is a soft preference: same-city DOPs get a small ranking nudge,
  // never a hard filter, because Saudi crews travel between cities routinely.
  if (!opts.city) return rows;
  return [...rows].sort((a, b) => {
    const bonus = (hit: DopSearchHit) => (hit.city && opts.city && hit.city === opts.city ? 0.03 : 0);
    return b.score + bonus(b) - (a.score + bonus(a));
  });
}

export async function countEmbeddableDops() {
  const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM "Dop" WHERE embedding IS NOT NULL AND status = 'APPROVED'`);
  return Number(count);
}

/** DOPs whose profile changed after their last embedding (used by the cron job). */
export async function findStaleDops(limit = 25) {
  return prisma.dop.findMany({
    where: {
      status: 'APPROVED',
      OR: [{ embeddedAt: null }, { embeddedAt: { lt: prisma.dop.fields.updatedAt } }],
    },
    select: {
      id: true,
      displayName: true,
      bio: true,
      styleTags: true,
      city: true,
      yearsExperience: true,
    },
    take: limit,
  });
}
