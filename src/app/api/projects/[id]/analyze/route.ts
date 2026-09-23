import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { runProductionAnalysis } from '@/agents/orchestrator';
import type { ProgressEvent } from '@/agents/types';

/**
 * The orchestrator runs inside this single serverless function and streams
 * newline-delimited JSON progress events to the UI, so the multi-agent run feels
 * live instead of a long black-box wait.
 *
 * `maxDuration` needs Fluid Compute (or a Pro plan) for feature-length scripts.
 * If a run ever outgrows it, the orchestrator's stages are already separable
 * into chained functions or a queue without touching the agents themselves.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await auth();

  if (!session?.user) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, ownerId: true, script: { select: { sceneCount: true } } },
  });

  if (!project) return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
  if (project.ownerId !== session.user.id && session.user.role !== Role.ADMIN) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403 });
  }
  if (!project.script) {
    return new Response(JSON.stringify({ error: 'NO_SCRIPT' }), { status: 400 });
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
        await runProductionAnalysis(id, send);
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
