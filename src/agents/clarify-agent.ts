import { generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { AgentName } from '@prisma/client';
import { lastToolResult, loggedTool, model, MODELS, withAgentRun, type RunContext } from './runtime';
import { describeSummary } from './equipment-agent';
import { withLanguage } from './language';
import { detectGaps, MAX_QUESTIONS, normaliseQuestions } from './clarifications';
import type { ClarifyQuestion, ProjectBrief, SceneSummary } from './types';

export const CLARIFY_SYSTEM = `You are an experienced producer meeting someone about their script. They may be a seasoned producer or someone making their very first film, so speak plainly and never use technical film jargon (no lenses, lighting setups, drones, frame rates — you and your team work those out from the script yourselves).

The script has been read. Before you plan the shoot and the money, call askProducer once with the few questions any producer would ask a client:
- roughly how much they can spend (offer ranges in SAR as options),
- where the work will be shown (cinema, TV, a streaming platform, social media, festivals) and when it should come out,
- when they want to shoot and whether there is a hard deadline,
- where they will shoot (which city, what kinds of places),
- what kind of cast they have in mind (known stars, a mix, new faces, non-actors).

Rules:
- Skip anything the brief already answers. Three to five questions, most important first.
- Each question is short, friendly and answerable with one tap: always give two to four options.
- Tag each question with its topic.
- Every question carries the assumption you will work from if they skip it — a sensible default, never "unknown".`;

const askSchema = z.object({
  questions: z
    .array(
      z.object({
        topic: z.enum(['budget', 'release', 'schedule', 'location', 'cast', 'other']),
        question: z.string().min(8).max(300),
        why: z.string().max(200).describe('In plain words, what the answer helps with.'),
        options: z.array(z.string().min(1).max(80)).max(4).describe('Suggested answers, when it is a choice.'),
        assumption: z.string().min(2).max(200).describe('What you will assume if the producer skips it.'),
      }),
    )
    .min(1)
    .max(MAX_QUESTIONS),
});

type AskResult = { questions: ClarifyQuestion[] };

/**
 * The clarification step: runs once, after the breakdown and before anything is
 * priced. When the agent calls askProducer the run pauses on those questions;
 * when it does not, the run carries straight on.
 *
 * A failure here never sinks the run — the producer loses a chance to clarify,
 * not the sheet.
 */
export async function runClarifyAgent(
  ctx: RunContext,
  brief: ProjectBrief,
  summary: SceneSummary,
): Promise<ClarifyQuestion[]> {
  const system = withLanguage(CLARIFY_SYSTEM, brief.locale);
  const gaps = detectGaps(brief, summary);

  try {
    return await withAgentRun(
      {
        ctx,
        agent: AgentName.ORCHESTRATOR,
        model: MODELS.reasoning,
        systemPrompt: system,
        input: { stage: 'clarify', gaps, locale: brief.locale },
      },
      async (handle) => {
        ctx.report({ type: 'stage', stage: 'clarifying', pct: 48 });

        const askProducer = loggedTool(handle, 'askProducer', {
          description:
            'Pause the run and ask the producer the questions that would change the package, crew or budget. Call at most once.',
          inputSchema: askSchema,
          execute: async ({ questions }): Promise<AskResult> => ({ questions: normaliseQuestions(questions) }),
        });

        await generateText({
          model: model('reasoning'),
          system,
          tools: { askProducer },
          stopWhen: stepCountIs(2),
          temperature: 0.2,
          prompt: [
            `Production: "${brief.name}" — ${brief.type}, budget tier ${brief.budgetTier}, shooting in ${brief.city}.`,
            brief.visualStyleTags.length ? `Visual style: ${brief.visualStyleTags.join(', ')}.` : '',
            brief.synopsis ? `Synopsis: ${brief.synopsis.slice(0, 1200)}` : '',
            brief.shootStartDate
              ? `Shoot dates: ${iso(brief.shootStartDate)} to ${iso(brief.shootEndDate ?? brief.shootStartDate)}.`
              : '',
            '',
            'Scene breakdown statistics:',
            describeSummary(summary),
            '',
            gaps.length ? `Candidate gaps spotted by code:\n${gaps.map((gap) => `- ${gap}`).join('\n')}` : 'Code found no obvious gaps.',
          ]
            .filter(Boolean)
            .join('\n'),
        });

        const asked = lastToolResult<AskResult>(handle, 'askProducer');
        const questions = asked && Array.isArray(asked.questions) ? asked.questions : [];
        return { output: questions };
      },
    );
  } catch (error) {
    ctx.report({
      type: 'log',
      message: `Clarification skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return [];
  }
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}
