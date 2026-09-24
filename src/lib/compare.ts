import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Share tokens and the cron secret are both long random strings, so a timing
 * attack on them over a network is not a practical threat — but comparing a
 * secret with `===` is a habit that stops being harmless the moment something
 * shorter is compared with it. Node needs equal lengths, and the length itself
 * is not the secret.
 */
export function constantTimeEqual(candidate: string, actual: string) {
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
