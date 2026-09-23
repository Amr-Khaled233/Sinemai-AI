import { z } from 'zod';
import { embedText, vectorSearchDops, type DopSearchHit } from '@/lib/embeddings';
import { loggedTool, type AgentRunHandle } from '../runtime';

/**
 * DOP matching tools: one embedding call, one cosine-similarity search over the
 * pgvector column. The agent writes the query text and interprets the scores;
 * it never gets to name a cinematographer that did not come back from search.
 */

export const embedTextSchema = z.object({
  text: z
    .string()
    .min(8)
    .max(4000)
    .describe(
      'The style query to embed: the project visual-style tags plus the dominant lighting/mood notes from the scene breakdown, written as a short cinematography brief.',
    ),
});

export const vectorSearchSchema = z.object({
  topN: z.number().int().min(3).max(12).describe('How many cinematographers to retrieve.'),
  city: z
    .string()
    .optional()
    .describe('Preferred city, used as a soft ranking nudge only — never a hard filter.'),
});

export type EmbedToolResult = { dimensions: number; cached: true | false; text: string };
export type SearchToolResult = { hits: DopSearchHit[]; searchedCount: number };

export function makeDopTools(handle: AgentRunHandle, context: { city?: string | null }) {
  // The embedding is held per-run so the search tool can use it without the
  // model ever having to carry 1536 floats through its context.
  let queryEmbedding: number[] | null = null;
  let queryText = '';

  const tools = {
    embedText: loggedTool(handle, 'embedText', {
      description:
        'Embed a style query with text-embedding-3-large (1536 dims). Call this exactly once, before vectorSearchDOPs.',
      inputSchema: embedTextSchema,
      execute: async ({ text }) => {
        queryEmbedding = await embedText(text);
        queryText = text;
        return { dimensions: queryEmbedding.length, cached: false as const, text };
      },
    }),

    vectorSearchDOPs: loggedTool(
      handle,
      'vectorSearchDOPs',
      {
        description:
          'Cosine-similarity search over approved cinematographer profiles using the embedding from embedText. Returns each DOP with a 0..1 similarity score, their submitted style tags and portfolio links.',
        inputSchema: vectorSearchSchema,
        execute: async ({ topN, city }) => {
          if (!queryEmbedding) throw new Error('Call embedText before vectorSearchDOPs.');
          const hits = await vectorSearchDops(queryEmbedding, topN, { city: city ?? context.city ?? null });
          return { hits, searchedCount: hits.length };
        },
      },
    ),
  };

  return {
    tools,
    getQueryText: () => queryText,
    hasEmbedding: () => queryEmbedding !== null,
  };
}
