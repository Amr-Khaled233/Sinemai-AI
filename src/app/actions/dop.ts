'use server';

import { revalidatePath } from 'next/cache';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { publicError } from '@/lib/security';
import { auth } from '@/lib/auth';
import { dopProfileSchema } from '@/lib/validation';
import { buildDopEmbeddingText, embedText, writeDopEmbedding } from '@/lib/embeddings';

export type ActionResult = { ok: true; embedded: boolean } | { ok: false; error: string };

/**
 * Saving a profile re-generates its style vector. Embedding is attempted inline
 * (it is a single fast call) and, if it fails or no API key is configured, the
 * profile is left stale for the nightly cron job to pick up — the save itself
 * never fails because of the embedding step.
 */
export async function saveDopProfile(formData: FormData): Promise<ActionResult> {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.DOP) return { ok: false, error: 'UNAUTHORIZED' };

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

    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'INVALID_INPUT' };
    }
    const data = parsed.data;

    const dop = await prisma.dop.update({
      where: { userId: session.user.id },
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
      const vector = await embedText(text);
      await writeDopEmbedding(dop.id, text, vector);
      embedded = true;
    } catch (error) {
      console.warn('[dop:embed] deferred to cron', error);
    }

    revalidatePath('/[locale]/dop', 'page');
    return { ok: true, embedded };
  } catch (error) {
    return { ok: false, error: publicError(error, 'dop') };
  }
}
