import { openai } from '@ai-sdk/openai';
import type { Tool } from 'ai';
import type { z } from 'zod';
import { AgentName, AgentRunStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ProgressReporter } from './types';

/**
 * Agent runtime: model registry, per-agent run logging, and the tool wrapper
 * that records every tool call. Nothing an agent does is invisible — each run
 * and each tool call lands in AgentRun / AgentToolCall for debugging and for
 * tuning the matching rules later.
 */

// Reasoning-heavy agents get gpt-4o; narrow, cheap agents get gpt-4o-mini.
export const MODELS = {
  reasoning: 'gpt-4o',
  cheap: 'gpt-4o-mini',
} as const;

export type ModelTier = keyof typeof MODELS;

export function model(tier: ModelTier) {
  return openai(MODELS[tier]);
}

export type RunContext = {
  projectId: string;
  report: ProgressReporter;
  /** Model ids actually used, collected for the sheet's provenance block. */
  modelVersions: Record<string, string>;
};

export function createRunContext(projectId: string, report: ProgressReporter): RunContext {
  return { projectId, report, modelVersions: {} };
}

export type AgentRunHandle = {
  id: string;
  /** Tool-call records collected during this run, in call order. */
  toolCalls: Array<{ toolName: string; args: unknown; result: unknown }>;
};

export async function startRun(args: {
  ctx: RunContext;
  agent: AgentName;
  attempt?: number;
  model?: string;
  systemPrompt?: string;
  input: unknown;
}): Promise<AgentRunHandle> {
  const run = await prisma.agentRun.create({
    data: {
      projectId: args.ctx.projectId,
      agent: args.agent,
      attempt: args.attempt ?? 1,
      status: AgentRunStatus.RUNNING,
      model: args.model,
      systemPrompt: args.systemPrompt?.slice(0, 8000),
      input: toJson(args.input),
    },
    select: { id: true },
  });
  if (args.model) args.ctx.modelVersions[args.agent] = args.model;
  return { id: run.id, toolCalls: [] };
}

export async function finishRun(
  handle: AgentRunHandle,
  args: {
    status: AgentRunStatus;
    output?: unknown;
    errorText?: string;
    criticFlag?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
    startedAt: number;
  },
) {
  await prisma.agentRun.update({
    where: { id: handle.id },
    data: {
      status: args.status,
      output: args.output === undefined ? undefined : toJson(args.output),
      errorText: args.errorText?.slice(0, 4000),
      criticFlag: args.criticFlag?.slice(0, 2000),
      promptTokens: args.usage?.inputTokens,
      completionTokens: args.usage?.outputTokens,
      latencyMs: Date.now() - args.startedAt,
      finishedAt: new Date(),
    },
  });
}

/**
 * Wraps a tool so every invocation is persisted and its result kept in memory.
 * Downstream code reads facts from `handle.toolCalls`, never from model prose —
 * that is what keeps specs, prices and names out of the model's imagination.
 */
export function loggedTool<TSchema extends z.ZodType, TResult>(
  handle: AgentRunHandle,
  toolName: string,
  definition: {
    description: string;
    inputSchema: TSchema;
    execute: (args: z.infer<TSchema>) => Promise<TResult>;
  },
): Tool<z.infer<TSchema>, TResult> {
  // `tool()` is an identity helper for inference only; building the object
  // directly keeps the generic signature above intact.
  const wrapped = {
    description: definition.description,
    inputSchema: definition.inputSchema,
    execute: async (rawArgs: z.infer<TSchema>): Promise<TResult> => {
      const startedAt = Date.now();
      try {
        const result = await definition.execute(rawArgs);
        handle.toolCalls.push({ toolName, args: rawArgs, result });
        await prisma.agentToolCall.create({
          data: {
            runId: handle.id,
            toolName,
            args: toJson(rawArgs),
            result: toJson(result),
            latencyMs: Date.now() - startedAt,
          },
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.agentToolCall.create({
          data: {
            runId: handle.id,
            toolName,
            args: toJson(rawArgs),
            errorText: message.slice(0, 2000),
            latencyMs: Date.now() - startedAt,
          },
        });
        // Returned rather than thrown: the agent should see the failure and adapt.
        return { error: message } as unknown as TResult;
      }
    },
  };
  return wrapped as unknown as Tool<z.infer<TSchema>, TResult>;
}

/** Latest tool result for a given tool name, or null when it was never called. */
export function lastToolResult<T>(handle: AgentRunHandle, toolName: string): T | null {
  for (let i = handle.toolCalls.length - 1; i >= 0; i -= 1) {
    if (handle.toolCalls[i].toolName === toolName) return handle.toolCalls[i].result as T;
  }
  return null;
}

export function allToolResults<T>(handle: AgentRunHandle, toolName: string): T[] {
  return handle.toolCalls.filter((c) => c.toolName === toolName).map((c) => c.result as T);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  // Dates and undefined are not valid JSON payloads for Prisma's Json columns.
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}


/**
 * Wraps one agent invocation: opens the run row, records the outcome, and marks
 * it FAILED before re-throwing so a crashed agent is never silently missing
 * from the trail.
 *
 * Six agents were each repeating this by hand, which meant six places where a
 * new failure path could forget to close its run row.
 */
export async function withAgentRun<T>(
  args: {
    ctx: RunContext;
    agent: AgentName;
    attempt?: number;
    model?: string;
    systemPrompt?: string;
    input: unknown;
  },
  body: (handle: AgentRunHandle) => Promise<{ output: T; status?: AgentRunStatus; criticFlag?: string }>,
): Promise<T> {
  const startedAt = Date.now();
  const handle = await startRun(args);

  try {
    const { output, status, criticFlag } = await body(handle);
    await finishRun(handle, {
      status: status ?? AgentRunStatus.OK,
      output,
      criticFlag,
      startedAt,
    });
    return output;
  } catch (error) {
    await finishRun(handle, {
      status: AgentRunStatus.FAILED,
      errorText: error instanceof Error ? error.message : String(error),
      startedAt,
    });
    throw error;
  }
}
