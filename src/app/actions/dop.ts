'use server';

import { prisma } from '@/lib/prisma';
import { dopProfileSchema } from '@/lib/validation';
import { buildDopEmbeddingText, embedText, writeDopEmbedding } from '@/lib/embeddings';
import { REVALIDATE, requireDopProfile, revalidate, runAction } from './shared';

/**
 * Saving a profile re-generates its style vector. Embedding is attempted inline
 * (one fast call) and, if it fails or no API key is configured, the profile is
 * left stale for the nightly cron to pick up — the save itself never fails
 * because of the embedding step.
 */
export async function saveDopProfile(formData: FormData) {
  return runAction('saveDopProfile', async () => {
    const { user } = await requireDopProfile();

    const parsed = dopProfileSchema.safeParse({
      displayName: formData.get('displayName'),
      displayNameAr: formData.get('displayNameAr') ?? '',
      bio: formData.get('bio'),
      city: formData.get('city') ?? '',
      dayRate: formData.get('dayRate') || undefined,
      yearsExperience: formData.get('yearsExperience') || undefined,
      portfolioLinks: String(formData.get('portfolioLinks') ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      styleTags: formData.getAll('styleTags').map(String),
    });

    if (!parsed.success) throw new Error('INVALID_INPUT');
    const data = parsed.data;

    const dop = await prisma.dop.update({
      where: { userId: user.id },
      data: {
        displayName: data.displayName,
        displayNameAr: data.displayNameAr || null,
        bio: data.bio,
        city: data.city || null,
        dayRate: data.dayRate ?? null,
        yearsExperience: data.yearsExperience ?? null,
        portfolioLinks: data.portfolioLinks,
        styleTags: data.styleTags,
      },
      select: {
        id: true,
        displayName: true,
        bio: true,
        styleTags: true,
        city: true,
        yearsExperience: true,
      },
    });

    let embedded = false;
    try {
      const text = buildDopEmbeddingText(dop);
      await writeDopEmbedding(dop.id, text, await embedText(text));
      embedded = true;
    } catch (error) {
      console.warn('[dop:embed] deferred to cron', error);
    }

    revalidate(REVALIDATE.dopProfile);
    return { embedded };
  });
}
