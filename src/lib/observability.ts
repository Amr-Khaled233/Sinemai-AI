/**
 * Error reporting.
 *
 * Deliberately vendor-neutral. Everything goes to structured stdout, which
 * Vercel, Datadog and every other log pipeline already ingest, and optionally
 * to a webhook so a team can get errors in Slack or a collector without this
 * codebase taking a dependency on one. Sentry drops in at `forward()` if that
 * is the route taken later.
 *
 * It runs in every runtime — node, edge middleware and instrumentation — so it
 * uses Web Crypto and a plain string hash rather than node:crypto.
 *
 * Two properties matter more than the destination:
 *  - every report carries a reference the user can quote, so a support message
 *    maps to one log line;
 *  - nothing secret is ever written, because the payloads passing through here
 *    include prompts, tokens and connection strings.
 */

export type ErrorSeverity = 'warning' | 'error' | 'fatal';

export type ErrorContext = {
  /** Where it happened: 'analyze-route', 'saveInventoryItem', 'agent:EQUIPMENT'. */
  scope: string;
  severity?: ErrorSeverity;
  userId?: string;
  projectId?: string;
  route?: string;
  extra?: Record<string, unknown>;
};

const SECRET_PATTERN =
  /(sk-[A-Za-z0-9_-]{8,}|postgres(?:ql)?:\/\/[^\s"']+|Bearer\s+[A-Za-z0-9._-]{8,}|vercel_blob_rw_[A-Za-z0-9_-]+|re_[A-Za-z0-9_-]{8,})/gi;

/** Replaces anything that looks like a credential before it reaches a log. */
export function redact(value: string) {
  return value.replace(SECRET_PATTERN, '[redacted]');
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (typeof value === 'string') return redact(value.slice(0, 1000));
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactDeep(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        // Never log a field that is named like a secret, whatever it holds.
        .map(([key, item]) =>
          /token|secret|password|authorization|cookie|apikey|api_key/i.test(key)
            ? [key, '[redacted]']
            : [key, redactDeep(item, depth + 1)],
        ),
    );
  }
  return value;
}

/**
 * Groups the same failure together across reports: the scope plus the message
 * with volatile parts (ids, numbers, quoted values) stripped out.
 *
 * FNV-1a rather than a cryptographic hash — this is a grouping key, not a
 * signature, and it has to run in the edge runtime as well as in node.
 */
export function fingerprint(scope: string, message: string) {
  const stable = message
    .replace(/[0-9a-f]{8,}/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/'[^']*'/g, "'#'")
    .slice(0, 200);

  const input = `${scope}::${stable}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export type ErrorReport = {
  reference: string;
  fingerprint: string;
  scope: string;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  at: string;
};

/**
 * Records an error and returns a reference the caller can show the user.
 * Never throws: a failure in the reporter must not replace the original error.
 */
export function reportError(error: unknown, context: ErrorContext): ErrorReport {
  // Web Crypto is present in node 19+, the edge runtime and the browser.
  const reference = globalThis.crypto.randomUUID().slice(0, 8);
  const message = error instanceof Error ? error.message : String(error);
  const severity = context.severity ?? 'error';

  const report: ErrorReport = {
    reference,
    fingerprint: fingerprint(context.scope, message),
    scope: context.scope,
    severity,
    message: redact(message),
    stack: error instanceof Error && error.stack ? redact(error.stack).split('\n').slice(0, 12).join('\n') : undefined,
    at: new Date().toISOString(),
  };

  try {
    const line = {
      level: severity,
      event: 'app.error',
      ...report,
      userId: context.userId,
      projectId: context.projectId,
      route: context.route,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
      ...(context.extra ? { extra: redactDeep(context.extra) } : {}),
    };
    // One JSON object per line is what log pipelines expect.
    console.error(JSON.stringify(line));
    void forward(line);
  } catch {
    // Reporting must never mask the original failure.
    console.error(`[${context.scope}] ${report.message} (ref ${reference})`);
  }

  return report;
}

/**
 * Optional outbound hop. Fire-and-forget with a short timeout, so a slow or
 * dead collector cannot hold a request open.
 */
async function forward(payload: Record<string, unknown>) {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // A collector being down is not worth a second error.
  }
}

/** Structured counterpart for things worth noticing that are not failures. */
export function reportEvent(event: string, data: Record<string, unknown> = {}) {
  try {
    console.info(JSON.stringify({ level: 'info', event, ...redactDeep(data) as object, at: new Date().toISOString() }));
  } catch {
    console.info(event);
  }
}
