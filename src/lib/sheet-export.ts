import 'server-only';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sheetScenesArg } from '@/lib/sheet-query';
import { auth } from '@/lib/auth';
import { normaliseLocale } from '@/agents/language';
import { clientIp, consumeRateLimit, LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { constantTimeEqual } from '@/lib/compare';

/**
 * The gate both export routes share.
 *
 * The PDF and the spreadsheet had a copy each of the same access check and the
 * same query — sixty lines that had to stay identical for the rules to hold.
 * One of them is now the rule, so a change to who may download a sheet cannot
 * apply to one format and not the other.
 */

/** Everything an export needs, in one query. */
export async function loadSheetForExport(projectId: string, token: string | null) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      recommendation: true,
      shareLinks: { where: { revoked: false }, select: { token: true, expiresAt: true } },
      script: {
        select: {
          scenes: sheetScenesArg,
        },
      },
    },
  });

  if (!project?.recommendation) return null;
  return { ...project, recommendation: project.recommendation, token };
}

export type ExportableSheet = NonNullable<Awaited<ReturnType<typeof loadSheetForExport>>>;

/**
 * Who may download: the owner, an admin, or the holder of a live share token.
 * Returns null when access is granted, or the response to send when it is not.
 */
export async function authoriseExport(sheet: ExportableSheet): Promise<Response | null> {
  const now = new Date();
  const validToken =
    sheet.token !== null &&
    sheet.shareLinks.some(
      (link) => constantTimeEqual(sheet.token!, link.token) && (!link.expiresAt || link.expiresAt > now),
    );

  if (validToken) return null;

  const session = await auth();
  const allowed =
    session?.user && (session.user.id === sheet.ownerId || session.user.role === Role.ADMIN);
  return allowed ? null : new Response('Forbidden', { status: 403 });
}

/**
 * Throttles exports.
 *
 * Rendering a PDF or building a workbook is the most expensive thing an
 * unauthenticated caller can ask this app to do — a share link is a URL anyone
 * can hold and replay. The limit is per project and per caller, so a recipient
 * downloading a sheet a few times is unaffected and a loop is not.
 */
export async function throttleExport(
  request: Request,
  projectId: string,
  format: 'pdf' | 'xlsx',
  token: string | null,
) {
  const caller = token ? `token:${token.slice(0, 12)}` : `ip:${clientIp(request)}`;
  const limit = await consumeRateLimit(`export:${format}:${projectId}:${caller}`, LIMITS.export);
  return limit.allowed ? null : rateLimitResponse(limit);
}

/** `?locale=` (the page the reader is on) → the sheet's own language → Arabic. */
export function exportLocale(url: URL, sheetLocale: string) {
  return normaliseLocale(url.searchParams.get('locale') ?? sheetLocale);
}

/** A download name that is safe in a header and still readable in Arabic. */
export function exportFileName(projectName: string, extension: 'pdf' | 'xlsx') {
  const stem = projectName.replace(/[^\w؀-ۿ-]+/g, '-').slice(0, 60);
  return `sinemai-${stem}.${extension}`;
}
