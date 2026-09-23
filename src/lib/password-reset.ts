import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';

/**
 * Password reset.
 *
 * The raw token only ever exists in the email link; the database stores its
 * SHA-256 hash, so a leaked table cannot be replayed against the reset
 * endpoint. Tokens are single use and short-lived, and requesting one
 * invalidates any earlier unused token for that account.
 */

export const RESET_TTL_MINUTES = 60;

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createResetToken(userId: string) {
  const token = randomBytes(32).toString('base64url');

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  return token;
}

export type ResetLookup =
  | { ok: true; userId: string; tokenId: string }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'USED' };

export async function lookupResetToken(token: string): Promise<ResetLookup> {
  if (!token || token.length < 16) return { ok: false, reason: 'INVALID' };

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!row) return { ok: false, reason: 'INVALID' };
  if (row.usedAt) return { ok: false, reason: 'USED' };
  if (row.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, userId: row.userId, tokenId: row.id };
}

export async function consumeResetToken(tokenId: string, userId: string, passwordHash: string) {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } }),
    // Any other pending token for this account is now meaningless.
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
}

/** Housekeeping for the nightly cron. */
export async function purgeExpiredResetTokens() {
  const { count } = await prisma.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
  });
  return count;
}
