import 'server-only';
import { reportError } from '@/lib/observability';

const SAFE_ERROR_CODES = new Set([
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'NO_SCRIPT',
  'EMPTY_SCRIPT',
  'NO_SCENES_FOUND',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'AVAILABLE_EXCEEDS_TOTAL',
  'INVALID_RANGE',
  'INVALID_SPECS_JSON',
  'RATE_LIMITED',
  'EMAIL_TAKEN',
  'INQUIRY_CLOSED',
]);

/**
 * Server actions were returning raw exception messages to the browser, which
 * leaks Prisma errors and internal state names. Known codes pass through;
 * anything else is logged server-side and reported as a generic failure.
 */
export function publicError(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (SAFE_ERROR_CODES.has(message)) return message;
  // Anything unrecognised is a real fault: report it, show the user nothing.
  reportError(error, { scope: context });
  return 'UNEXPECTED_ERROR';
}
