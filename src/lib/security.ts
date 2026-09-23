/**
 * Shared security helpers.
 *
 * Each function here exists because of a concrete hole found in review, and the
 * comment says which one, so nobody removes it as "defensive noise" later.
 */

/**
 * Escapes user content before it is interpolated into an HTML email.
 *
 * Inquiry subjects, messages and display names are attacker-controlled and were
 * being dropped straight into the mail template. React protects the app's own
 * pages, but an email body is hand-built HTML with no such protection.
 */
export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes, then turns newlines into <br> — for multi-line message bodies. */
export function escapeHtmlMultiline(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

const SAFE_URL_SCHEMES = new Set(['http:', 'https:']);

/**
 * `new URL()` — and therefore Zod's `.url()` — happily accepts `javascript:`,
 * `data:` and `vbscript:`. Portfolio links are submitted by cinematographers
 * and rendered as href in a producer's sheet, so an unchecked scheme is a
 * stored XSS vector. Everything that becomes an href goes through this.
 */
export function isSafeHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return SAFE_URL_SCHEMES.has(url.protocol);
  } catch {
    return false;
  }
}

/** Keeps only the links that are safe to render as an href. */
export function safeHttpUrls(values: readonly string[]) {
  return values.filter((value) => isSafeHttpUrl(value));
}

/** Returns the URL when it is safe to link to, otherwise null. */
export function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return isSafeHttpUrl(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------- uploads

const SCRIPT_EXTENSIONS = ['.pdf', '.txt', '.md', '.fountain', '.fdx', '.xml'];
const SCRIPT_MIME_PREFIXES = ['application/pdf', 'text/', 'application/xml', 'application/octet-stream'];

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'];
// SVG is deliberately absent: it can carry script, and blob URLs are opened
// directly by browsers.
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];

export type UploadKind = 'script' | 'image';

export function isAllowedUpload(kind: UploadKind, fileName: string, mimeType: string) {
  const name = fileName.toLowerCase();
  const type = (mimeType || '').toLowerCase();

  if (kind === 'image') {
    return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext)) && IMAGE_MIME_TYPES.includes(type);
  }

  // Script formats are often sent as octet-stream by browsers, so the extension
  // is what decides; the MIME type only has to be plausible.
  const extensionOk = SCRIPT_EXTENSIONS.some((ext) => name.endsWith(ext));
  const typeOk = type === '' || SCRIPT_MIME_PREFIXES.some((prefix) => type.startsWith(prefix));
  return extensionOk && typeOk;
}

// ---------------------------------------------------------------- CSRF

/**
 * Route handlers do not get the CSRF protection Next.js builds into Server
 * Actions. The NextAuth session cookie is SameSite=Lax, which already blocks
 * cross-site form posts, and this is the second lock: a state-changing request
 * must come from our own origin.
 */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  // Same-origin fetches from our own pages always send Origin; server-to-server
  // callers (cron, queues) authenticate with a bearer token instead.
  if (!origin) return request.headers.get('sec-fetch-site') !== 'cross-site';

  const allowed = new Set<string>();
  if (process.env.NEXTAUTH_URL) allowed.add(new URL(process.env.NEXTAUTH_URL).origin);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    allowed.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);

  // A preview deployment's own host is legitimate; so is the request host.
  const host = request.headers.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }

  return allowed.has(origin);
}

/** Standard rejection for a request that fails the origin check. */
export function crossOriginRejected() {
  return Response.json({ error: 'CROSS_ORIGIN_REJECTED' }, { status: 403 });
}

// ---------------------------------------------------------------- error hygiene

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
]);

/**
 * Server actions were returning raw exception messages to the browser, which
 * leaks Prisma errors and internal state names. Known codes pass through;
 * anything else is logged server-side and reported as a generic failure.
 */
export function publicError(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (SAFE_ERROR_CODES.has(message)) return message;
  console.error(`[${context}]`, error);
  return 'UNEXPECTED_ERROR';
}
