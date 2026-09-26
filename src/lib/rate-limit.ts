import { prisma } from '@/lib/prisma';
import { reportError } from '@/lib/observability';

/**
 * Fixed-window rate limiting, backed by Postgres.
 *
 * In-memory counters are useless here: each serverless invocation may run on a
 * fresh instance, so a caller can cycle instances to reset the count. The
 * window row is shared, which also means a limit holds across regions.
 *
 * Failure mode is deliberate: if the limiter itself errors, the request is
 * allowed through. A database blip must not lock everyone out of signing in.
 */

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export const LIMITS = {
  /** Sign-in attempts per email+IP. Slows credential stuffing without locking accounts. */
  login: { limit: 8, windowMs: 10 * 60_000 },
  /** Password reset requests per email, and per IP, to prevent mail bombing. */
  passwordReset: { limit: 5, windowMs: 30 * 60_000 },
  /**
   * Checking whether a reset link is still live. Looser than requesting one,
   * because the reset page asks on every load and several people can share an
   * IP — but capped, since it answers a question about a secret.
   */
  resetCheck: { limit: 30, windowMs: 10 * 60_000 },
  /** New accounts per IP. */
  register: { limit: 5, windowMs: 60 * 60_000 },
  /** Analysis runs per user. Each one spends real money on model calls. */
  analysis: { limit: 12, windowMs: 60 * 60_000 },
  /** Slices of an in-flight analysis; generous, since one run needs several. */
  analysisStep: { limit: 200, windowMs: 60 * 60_000 },
  /**
   * Sheet exports per project, per caller. Rendering a PDF or building a
   * workbook is the heaviest thing an unauthenticated share-link holder can
   * ask for, so replaying that URL in a loop is capped.
   */
  export: { limit: 30, windowMs: 10 * 60_000 },
} as const;

export async function consumeRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  const now = new Date();

  try {
    const existing = await prisma.rateLimit.findUnique({ where: { key } });

    // No window, or the previous one has expired: start a fresh one.
    if (!existing || existing.windowEnd <= now) {
      const windowEnd = new Date(now.getTime() + windowMs);
      await prisma.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, windowEnd },
        update: { count: 1, windowEnd },
      });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowEnd.getTime() - now.getTime()) / 1000));

    if (existing.count >= limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    const updated = await prisma.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
      select: { count: true },
    });

    return {
      allowed: updated.count <= limit,
      remaining: Math.max(0, limit - updated.count),
      retryAfterSeconds,
    };
  } catch (error) {
    // Fail open: the limiter is a safeguard, not an authentication control.
    // Worth reporting though — a limiter that is silently off is a cost risk.
    reportError(error, { scope: 'rate-limit', severity: 'warning', extra: { key } });
    return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
  }
}

/** Client IP as seen through Vercel's proxy chain. */
export function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimitResponse(result: RateLimitResult) {
  return Response.json(
    { error: 'RATE_LIMITED', retryAfter: result.retryAfterSeconds },
    { status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } },
  );
}

/** Housekeeping for the nightly cron. */
export async function purgeExpiredRateLimits() {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { windowEnd: { lt: new Date(Date.now() - 3_600_000) } },
  });
  return count;
}
