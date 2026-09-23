import { AnalysisStage, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { advanceAnalysis, beginAnalysis } from '@/agents/orchestrator';
import { normaliseLocale } from '@/agents/language';
import { consumeRateLimit, LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { crossOriginRejected, isSameOrigin } from '@/lib/security';
import type { ProgressEvent } from '@/agents/types';

/**
 * One slice of the agent graph per request.
 *
 * The orchestrator is a resumable state machine: this route runs as many steps
 * as fit inside `STEP_BUDGET_MS` and then returns a resume point, so a run
 * never needs a function duration longer than `maxDuration` below. The client
 * keeps calling until `done`, which means a feature-length breakdown works on
 * a 60s plan without changing any agent.
 *
 * `start: true` begins a fresh run; without it the request continues the
 * existing checkpoint.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Leaves headroom for the final step to finish and the response to flush.
const STEP_BUDGET_MS = 40_000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return crossOriginRejected();

  const { id } = await context.params;
  const session = await auth();

  if (!session?.user) {
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, ownerId: true, script: { select: { sceneCount: true } } },
  });

  if (!project) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (project.ownerId !== session.user.id && session.user.role !== Role.ADMIN) {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }
  if (!project.script) return Response.json({ error: 'NO_SCRIPT' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { start?: boolean; locale?: string };
  const locale = normaliseLocale(body.locale);

  // Every run spends money on model calls, so starting one is capped per user;
  // continuing an existing run has a looser cap because a single analysis needs
  // several slices.
  const limit = body.start
    ? await consumeRateLimit(`analysis:start:${session.user.id}`, LIMITS.analysis)
    : await consumeRateLimit(`analysis:step:${session.user.id}`, LIMITS.analysisStep);
  if (!limit.allowed) return rateLimitResponse(limit);

  if (body.start) {
    await beginAnalysis(id, locale);
  } else {
    const state = await prisma.analysisState.findUnique({
      where: { projectId: id },
      select: { stage: true },
    });
    // Nothing to resume (a cold client, or state wiped by a new script upload).
    if (!state || state.stage === AnalysisStage.FAILED) await beginAnalysis(id, locale);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ProgressEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const outcome = await advanceAnalysis(id, send, { budgetMs: STEP_BUDGET_MS });
        // The final line always tells the client whether to call again.
        send({
          type: 'checkpoint',
          done: outcome.done,
          failed: Boolean(outcome.failed),
          stage: outcome.stage,
          pct: outcome.pct,
        });
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : 'ANALYSIS_FAILED',
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}

/** Current checkpoint, so a reloaded page can rejoin a run already in flight. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const project = await prisma.project.findUnique({
    where: { id },
    select: { ownerId: true, analysisState: true },
  });
  if (!project) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (project.ownerId !== session.user.id && session.user.role !== Role.ADMIN) {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const state = project.analysisState;
  return Response.json({
    stage: state?.stage ?? null,
    sceneCursor: state?.sceneCursor ?? 0,
    sceneTotal: state?.sceneTotal ?? 0,
    errorText: state?.errorText ?? null,
    updatedAt: state?.updatedAt ?? null,
  });
}
