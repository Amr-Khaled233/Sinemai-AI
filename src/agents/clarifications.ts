import type { ClarifyAnswer, ClarifyQuestion, ProjectBrief, SceneSummary } from './types';

/**
 * The pure half of the clarification step — no model, no database — so what
 * gets asked and how answers are applied can be tested directly.
 */

export const MAX_QUESTIONS = 5;
const MAX_ANSWER_LENGTH = 500;

/** What the model submits through askProducer, before ids are assigned. */
export type DraftQuestion = Omit<ClarifyQuestion, 'id' | 'topic'> & { topic?: ClarifyQuestion['topic'] };

/**
 * What the brief does not tell us yet, in plain language. The person on the
 * other side may never have made a film, so these are the questions any
 * producer would ask a client — money, audience, timing, place, cast — never
 * technical ones: the agents work out lenses, lights and drones themselves.
 *
 * They are handed to the agent as hints; it phrases the questions.
 */
export function detectGaps(brief: ProjectBrief, _summary: SceneSummary): string[] {
  const gaps: string[] = [];

  if (brief.budgetMax === null) {
    gaps.push('No budget yet: ask roughly how much they can spend, with ranges in SAR as options (e.g. under 100k, 100k–300k, 300k–1M, over 1M).');
  }
  gaps.push('Where will it be shown (cinema, TV, a streaming platform, social media, festivals) and roughly when is the release? This sets the quality bar and the deadline.');
  if (!brief.shootStartDate) {
    gaps.push('When do they want to shoot, and is there a hard deadline? This sets the schedule and what can be booked.');
  }
  gaps.push(`Where will they shoot — which city or kinds of places? (Assumed ${brief.city} until told.)`);
  gaps.push('Cast: known stars, a mix, new faces or non-actors? It changes the budget and who to suggest.');

  return gaps;
}

/** Stable ids and trimmed text, so answers can be matched back to their question. */
export function normaliseQuestions(questions: DraftQuestion[]): ClarifyQuestion[] {
  return questions.slice(0, MAX_QUESTIONS).map((q, index) => ({
    id: `q${index + 1}`,
    topic: q.topic ?? 'other',
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

/** The producer's budget as the agents should read it. */
export function describeBudget(brief: Pick<ProjectBrief, 'budgetMin' | 'budgetMax' | 'budgetTier'>): string {
  if (brief.budgetMin !== null && brief.budgetMax !== null) {
    return `The producer's budget is ${brief.budgetMin.toLocaleString('en')}–${brief.budgetMax.toLocaleString('en')} SAR (catalog tier ${brief.budgetTier}). Keep the mid estimate inside it, or say plainly what it would take to fit.`;
  }
  return `The producer has not given a budget yet (catalog tier ${brief.budgetTier} assumed). Aim for good value.`;
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
