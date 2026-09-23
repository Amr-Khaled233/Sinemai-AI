import { generateObject, generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { AgentName, AgentRunStatus } from '@prisma/client';
import { getSettings } from '@/lib/settings';
import type { DopSearchHit } from '@/lib/embeddings';
import { allToolResults, finishRun, model, MODELS, startRun, type RunContext } from './runtime';
import { makeDopTools } from './tools/dop-tools';
import type { DopMatch, DopResult, ProjectBrief, SceneSummary } from './types';

export const DOP_SYSTEM = `You match cinematographers to productions by visual style.

Workflow, in order:
1. Write a short cinematography brief from the director's visual-style tags and the recurring lighting notes in the scene breakdown, then pass it to embedText. Describe the look, not the plot: light quality, contrast, palette, movement, lens character.
2. Call vectorSearchDOPs to retrieve candidates.

Hard rules:
- Only cinematographers returned by vectorSearchDOPs exist. Never name anyone else, never invent a credit, a style tag or a portfolio link.
- Explain each match using that DOP's own submitted style tags and bio wording.
- Similarity scores are cosine similarity in 0..1. Be honest when a score is weak: say the match is indicative rather than strong.`;

const explainSchema = z.object({
  matches: z.array(
    z.object({
      dopId: z.string(),
      reason: z.string().min(15).max(220),
    }),
  ),
  note: z.string().max(300).nullable(),
});

export async function runDopAgent(
  ctx: RunContext,
  brief: ProjectBrief,
  summary: SceneSummary,
  options: { attempt?: number; criticFlag?: string } = {},
): Promise<DopResult> {
  const startedAt = Date.now();
  const settings = await getSettings();
  const handle = await startRun({
    ctx,
    agent: AgentName.DOP_MATCH,
    attempt: options.attempt ?? 1,
    model: MODELS.reasoning,
    systemPrompt: DOP_SYSTEM,
    input: {
      visualStyleTags: brief.visualStyleTags,
      lightingNotes: summary.dominantLightingNotes,
      criticFlag: options.criticFlag ?? null,
    },
  });

  try {
    ctx.report({ type: 'stage', stage: 'matching_dops', pct: 58 });

    const { tools, getQueryText } = makeDopTools(handle, { city: brief.city });

    await generateText({
      model: model('reasoning'),
      system: DOP_SYSTEM,
      tools,
      stopWhen: stepCountIs(4),
      temperature: 0.4,
      prompt: [
        `Production: "${brief.name}" — ${brief.type}, shooting in ${brief.city}.`,
        brief.visualStyleTags.length
          ? `Director's visual style tags: ${brief.visualStyleTags.join(', ')}.`
          : 'No visual style tags were selected; derive the look from the lighting notes.',
        summary.dominantLightingNotes.length
          ? `Recurring lighting notes from the breakdown: ${summary.dominantLightingNotes.join(' / ')}.`
          : '',
        `Scene mix: ${summary.nightScenePct}% night or dawn/dusk, ${summary.exteriorScenePct}% exterior, ${summary.highComplexityPct}% high lighting complexity.`,
        options.criticFlag ? `Reviewer flag on the previous matches: ${options.criticFlag}` : '',
        `Retrieve up to ${settings.dopMatchCount + 3} candidates.`,
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const hits = new Map<string, DopSearchHit>();
    for (const result of allToolResults<{ hits?: DopSearchHit[] }>(handle, 'vectorSearchDOPs')) {
      for (const hit of result.hits ?? []) {
        const existing = hits.get(hit.id);
        if (!existing || hit.score > existing.score) hits.set(hit.id, hit);
      }
    }

    const ranked = [...hits.values()].sort((a, b) => b.score - a.score);
    const usable = ranked.filter((h) => h.score >= settings.dopMatchMinScore).slice(0, settings.dopMatchCount);

    if (ranked.length === 0) {
      const empty: DopResult = {
        matches: [],
        queryText: getQueryText(),
        searchedCount: 0,
        note: 'No approved cinematographer profiles with embeddings were available to match against.',
      };
      await finishRun(handle, { status: AgentRunStatus.OK, output: empty, startedAt });
      return empty;
    }

    // Explanations are generated only for retrieved DOPs, and only from their own
    // submitted tags and bios.
    const { object } = await generateObject({
      model: model('cheap'),
      schema: explainSchema,
      system: DOP_SYSTEM,
      temperature: 0.4,
      prompt: [
        brief.visualStyleTags.length ? `Requested look: ${brief.visualStyleTags.join(', ')}.` : '',
        summary.dominantLightingNotes.length
          ? `Breakdown lighting notes: ${summary.dominantLightingNotes.slice(0, 6).join(' / ')}.`
          : '',
        '',
        'Candidates retrieved by similarity search:',
        ...(usable.length ? usable : ranked.slice(0, settings.dopMatchCount)).map(
          (hit) =>
            `dopId: ${hit.id} | ${hit.displayName} | score: ${hit.score.toFixed(3)} | city: ${
              hit.city ?? '—'
            } | tags: ${hit.styleTags.join(', ') || '—'} | bio: ${hit.bio.slice(0, 400)}`,
        ),
        '',
        'Write one reason per candidate, grounded in that candidate\'s tags and bio. Set note when the whole set is a weak stylistic match.',
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const reasons = new Map(object.matches.map((m) => [m.dopId, m.reason]));
    const shown = usable.length ? usable : ranked.slice(0, Math.min(3, ranked.length));

    const matches: DopMatch[] = shown.map((hit) => ({
      dopId: hit.id,
      name: hit.displayName,
      city: hit.city,
      score: Math.round(hit.score * 1000) / 1000,
      reason:
        reasons.get(hit.id) ??
        `Style tags overlap with the requested look: ${hit.styleTags.slice(0, 4).join(', ') || 'see portfolio'}.`,
      styleTags: hit.styleTags,
      portfolioLinks: hit.portfolioLinks,
      dayRate: hit.dayRate,
      yearsExperience: hit.yearsExperience,
    }));

    const weakSet = usable.length === 0;
    const result: DopResult = {
      matches,
      queryText: getQueryText(),
      searchedCount: ranked.length,
      note: weakSet
        ? `Best similarity was ${ranked[0].score.toFixed(2)}, below the ${settings.dopMatchMinScore} threshold — treat these as indicative only.`
        : object.note,
    };

    await finishRun(handle, {
      status: AgentRunStatus.OK,
      output: result,
      criticFlag: weakSet ? 'All DOP similarity scores were below the display threshold.' : undefined,
      startedAt,
    });

    return result;
  } catch (error) {
    await finishRun(handle, {
      status: AgentRunStatus.FAILED,
      errorText: error instanceof Error ? error.message : String(error),
      startedAt,
    });
    throw error;
  }
}
