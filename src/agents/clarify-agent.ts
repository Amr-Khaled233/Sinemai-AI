import { generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { AgentName } from '@prisma/client';
import { lastToolResult, loggedTool, model, MODELS, withAgentRun, type RunContext } from './runtime';
import { describeSummary } from './equipment-agent';
import { withLanguage } from './language';
import { detectGaps, MAX_QUESTIONS, normaliseQuestions } from './clarifications';
import type { ClarifyQuestion, ProjectBrief, SceneSummary } from './types';

export const CLARIFY_SYSTEM = `You are a line producer reviewing a brief before the equipment, crew and budget are committed. The script has already been broken down; you see the brief and the breakdown statistics.

Your only decision: is there anything the brief and the script leave genuinely open that would materially change the package, the crew or the budget? If so, call askProducer with those questions. If not, do not call any tool and reply with the single word CLEAR.

Rules:
- Ask only what changes the sheet. Never ask for something the brief or the breakdown already answers, and never ask out of curiosity.
- At most four questions, most consequential first. Fewer is better.
- Each question is short and answerable in a few words. Offer two to four concrete options whenever the answer is a choice.
- Every question carries the assumption you will work from if the producer skips it — a sensible default, not "unknown".
- The hints you are given are candidates, not a checklist: drop any that would not move the numbers for this production.`;

const askSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(8).max(300),
        why: z.string().max(200).describe('What the answer changes: equipment, crew, schedule or budget.'),
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
