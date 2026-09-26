import type { ClarifyAnswer, ClarifyQuestion, ProjectBrief, SceneSummary } from './types';

/**
 * The pure half of the clarification step — no model, no database — so what
 * gets asked and how answers are applied can be tested directly.
 */

export const MAX_QUESTIONS = 4;
const MAX_ANSWER_LENGTH = 500;

/** What the model submits through askProducer, before ids are assigned. */
export type DraftQuestion = Omit<ClarifyQuestion, 'id'>;

/**
 * Gaps code can see without a model. They are handed to the agent as hints —
 * it decides which matter for this production and phrases the question — so
 * the obvious ones are never missed and the irrelevant ones are never asked.
 */
export function detectGaps(brief: ProjectBrief, summary: SceneSummary): string[] {
  const gaps: string[] = [];

  if (!brief.shootStartDate) {
    gaps.push(
      `No shoot dates: vendor availability cannot be checked against real dates, and rental days rest on the estimated ${summary.shootDays} shoot day(s).`,
    );
  } else if (brief.shootEndDate) {
    const windowDays =
      Math.floor((brief.shootEndDate.getTime() - brief.shootStartDate.getTime()) / 86_400_000) + 1;
    if (windowDays > 0 && windowDays < summary.shootDays) {
      gaps.push(
        `The shoot window is ${windowDays} day(s) but the breakdown estimates ${summary.shootDays} shoot day(s): a second unit, longer days, or cut scenes?`,
      );
    }
  }

  if (brief.visualStyleTags.length === 0 && !brief.synopsis) {
    gaps.push('No visual style and no synopsis: cinematographer matching has only the lighting notes to go on.');
  }

  if (summary.movementMix.DRONE > 0) {
    gaps.push(
      `${summary.movementMix.DRONE} scene(s) read as drone work: a licensed aerial unit (GACA permit), or can it be covered another way?`,
    );
  }

  if (summary.specialRequirements.length > 0) {
    gaps.push(
      `Special requirements found in the script: ${summary.specialRequirements.join(', ')}. Each can add a specialist unit, rig or crew.`,
    );
  }

  return gaps;
}

/** Stable ids and trimmed text, so answers can be matched back to their question. */
export function normaliseQuestions(questions: DraftQuestion[]): ClarifyQuestion[] {
  return questions.slice(0, MAX_QUESTIONS).map((q, index) => ({
    id: `q${index + 1}`,
    question: q.question.trim(),
    why: q.why.trim(),
    options: [...new Set(q.options.map((option) => option.trim()).filter(Boolean))].slice(0, 4),
    assumption: q.assumption.trim(),
  }));
}

/**
 * Pairs the producer's answers with the questions that were asked. A blank or
 * missing answer falls back to the question's stated assumption, and anything
 * submitted for a question that was never asked is ignored.
 */
export function resolveAnswers(
  questions: ClarifyQuestion[],
  raw: Record<string, unknown>,
): ClarifyAnswer[] {
  return questions.map((q) => {
    const value = typeof raw[q.id] === 'string' ? (raw[q.id] as string).trim().slice(0, MAX_ANSWER_LENGTH) : '';
    return value
      ? { id: q.id, question: q.question, answer: value, assumed: false }
      : { id: q.id, question: q.question, answer: q.assumption, assumed: true };
  });
}

/** The block every downstream agent reads, so an answer outranks a guess everywhere. */
export function describeClarifications(answers: ClarifyAnswer[]): string {
  if (answers.length === 0) return '';
  return [
    "Producer's answers to open questions — treat these as facts about the production:",
    ...answers.map((a) =>
      a.assumed ? `- ${a.question} → not answered; working assumption: ${a.answer}` : `- ${a.question} → ${a.answer}`,
    ),
  ].join('\n');
}
