import { convertToModelMessages, createIdGenerator, hasToolCall, stepCountIs, streamText, type UIMessage } from 'ai';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { mayReadProject } from '@/lib/authz';
import { model } from '@/agents/runtime';
import { normaliseLocale } from '@/agents/language';
import { displayFx } from '@/lib/currency-server';
import { CHAT_MAX_HISTORY, chatSystemPrompt, makeChatTools } from '@/lib/project-chat';
import { consumeRateLimit, LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { crossOriginRejected, isSameOrigin } from '@/lib/security';
import { reportError } from '@/lib/observability';

/**
 * The project assistant's endpoint.
 *
 * The client sends only its newest message; the history comes from the
 * database, so a client cannot rewrite what was said or slip in a fake tool
 * result. Both the user's message and the assistant's reply are stored, and
 * the conversation is there again the next time the project is opened.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  locale: z.string().optional(),
  message: z.object({
    id: z.string().min(1).max(100),
    role: z.literal('user'),
    // Only text from the browser; tool parts are the server's to write.
    parts: z.array(z.object({ type: z.literal('text'), text: z.string().min(1).max(4000) })).min(1).max(4),
  }),
});

const serverMessageId = createIdGenerator({ prefix: 'msg', size: 16 });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return crossOriginRejected();

  const { id } = await context.params;
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      script: { select: { fileName: true, sceneCount: true } },
      recommendation: { select: { id: true } },
    },
  });
  if (!project) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!mayReadProject(project, session.user)) return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });

  // Every message is a paid model call with tools.
  const limit = await consumeRateLimit(`chat:${session.user.id}`, LIMITS.chat);
  if (!limit.allowed) return rateLimitResponse(limit);

  const locale = normaliseLocale(parsed.data.locale);
  const userMessage = parsed.data.message as UIMessage;

  const stored = await prisma.projectChatMessage.findMany({
    where: { projectId: id },
    orderBy: { createdAt: 'desc' },
    take: CHAT_MAX_HISTORY,
  });
  const history = stored
    .reverse()
    .map((row) => ({ id: row.id, role: row.role, parts: row.parts }) as unknown as UIMessage);

  await prisma.projectChatMessage.upsert({
    where: { id: userMessage.id },
    create: { id: userMessage.id, projectId: id, role: 'user', parts: userMessage.parts as unknown as Prisma.InputJsonValue },
    update: {},
  });

  const fx = await displayFx();
  const messages = [...history, userMessage];

  const result = streamText({
    model: model('reasoning'),
    system: chatSystemPrompt({
      locale,
      project,
      scriptFile: project.script?.fileName ?? (project.script ? 'pasted script' : null),
      sceneCount: project.script?.sceneCount ?? 0,
      hasSheet: Boolean(project.recommendation),
      currency: fx.code,
    }),
    messages: convertToModelMessages(messages),
    tools: makeChatTools({ projectId: id, locale, fx }),
    // A question to the producer ends the turn: the answer is their next message.
    stopWhen: [stepCountIs(6), hasToolCall('askUser')],
    temperature: 0.3,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: serverMessageId,
    onFinish: async ({ responseMessage }) => {
      if (responseMessage.parts.length === 0) return;
      await prisma.projectChatMessage
        .upsert({
          where: { id: responseMessage.id },
          create: {
            id: responseMessage.id,
            projectId: id,
            role: 'assistant',
            parts: responseMessage.parts as unknown as Prisma.InputJsonValue,
          },
          update: { parts: responseMessage.parts as unknown as Prisma.InputJsonValue },
        })
        .catch((error) => reportError(error, { scope: 'chat:persist', extra: { projectId: id } }));
    },
    // Model failures reach the chat as a code, never as a provider's raw message.
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/credit|quota|insufficient/i.test(message)) return 'AI_UNAVAILABLE';
      reportError(error, { scope: 'chat:stream', extra: { projectId: id } });
      return 'CHAT_FAILED';
    },
  });
}
