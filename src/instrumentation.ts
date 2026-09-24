/**
 * Next.js calls `onRequestError` for every unhandled server error — in a page,
 * a route handler or a server action. Routing it here means one place sees
 * every server-side failure instead of each call site remembering to log.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  const { reportError } = await import('@/lib/observability');

  reportError(error, {
    scope: `request:${context.routeType}`,
    severity: 'error',
    route: context.routePath || request.path,
    extra: {
      method: request.method,
      routerKind: context.routerKind,
      // The path is useful; query strings and headers are not worth the risk.
      path: request.path,
    },
  });
}

export function register() {
  // Reserved for tracing setup; the error hook above needs no registration.
}
