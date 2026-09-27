import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeClarifications,
  detectGaps,
  normaliseQuestions,
  resolveAnswers,
} from '../src/agents/clarifications';
import type { ClarifyQuestion, ProjectBrief, SceneSummary } from '../src/agents/types';

const brief = (over: Partial<ProjectBrief> = {}): ProjectBrief => ({
  projectId: 'p1',
  name: 'Test',
  type: 'COMMERCIAL' as ProjectBrief['type'],
  budgetTier: 'MID' as ProjectBrief['budgetTier'],
  visualStyleTags: ['naturalistic'],
  city: 'Riyadh',
  shootStartDate: new Date('2026-10-01'),
  shootEndDate: new Date('2026-10-05'),
  synopsis: 'A short spot.',
  budgetMin: null,
  budgetMax: null,
  locale: 'en',
  clarifications: [],
  sceneFlags: [],
  ...over,
});

const summary = (over: Partial<SceneSummary> = {}): SceneSummary => ({
  sceneCount: 10,
  totalHours: 30,
  shootDays: 3,
  pageCount: 8,
  nightScenePct: 20,
  exteriorScenePct: 40,
  highComplexityPct: 10,
  lightingMix: { LOW: 5, MEDIUM: 4, HIGH: 1 },
  movementMix: { STATIC: 6, HANDHELD: 4, STEADICAM_GIMBAL: 0, CRANE_DOLLY: 0, DRONE: 0 },
  timeMix: { DAY: 8, NIGHT: 2, DAWN_DUSK: 0 },
  environmentMix: { INTERIOR: 6, EXTERIOR: 4 },
  specialRequirements: [],
  dominantLightingNotes: [],
  ...over,
});

const question = (id: string, over: Partial<ClarifyQuestion> = {}): ClarifyQuestion => ({
  id,
  topic: 'other',
  question: `Question ${id}?`,
  why: 'Changes the package.',
  options: [],
  assumption: `assume ${id}`,
  ...over,
});

describe('detectGaps', () => {
  const topics = (gaps: string[]) => ({
    budget: gaps.some((gap) => /No budget yet/i.test(gap)),
    release: gaps.some((gap) => /shown/i.test(gap)),
    schedule: gaps.some((gap) => /When do they want to shoot/i.test(gap)),
    location: gaps.some((gap) => /Where will they shoot/i.test(gap)),
    cast: gaps.some((gap) => /Cast/i.test(gap)),
  });

  it('asks the plain questions any producer would ask a new client', () => {
    const gaps = detectGaps(brief({ shootStartDate: null, shootEndDate: null }), summary());
    assert.deepEqual(topics(gaps), { budget: true, release: true, schedule: true, location: true, cast: true });
  });

  it('skips the budget when a range was given, and the timing when dates are set', () => {
    const gaps = detectGaps(brief({ budgetMin: 100_000, budgetMax: 300_000 }), summary());
    assert.equal(topics(gaps).budget, false);
    assert.equal(topics(gaps).schedule, false);
  });

  it('never asks technical questions', () => {
    const gaps = detectGaps(
      brief({ budgetMin: null, budgetMax: null }),
      summary({
        movementMix: { STATIC: 6, HANDHELD: 2, STEADICAM_GIMBAL: 0, CRANE_DOLLY: 0, DRONE: 2 },
        specialRequirements: ['underwater'],
      }),
    );
    assert.ok(gaps.every((gap) => !/drone|underwater|lens|GACA/i.test(gap)), gaps.join('\n'));
  });
});

describe('normaliseQuestions', () => {
  it('assigns stable ids, trims text and de-duplicates options', () => {
    const [q] = normaliseQuestions([
      { question: '  Night or day?  ', why: ' lights ', options: ['Night', ' Night ', '', 'Day'], assumption: ' Night ' },
    ]);
    assert.deepEqual(q, {
      id: 'q1',
      topic: 'other',
      question: 'Night or day?',
      why: 'lights',
      options: ['Night', 'Day'],
      assumption: 'Night',
    });
  });

  it('caps the number of questions', () => {
    const drafts = Array.from({ length: 6 }, (_, i) => ({
      question: `Question ${i}?`,
      why: '',
      options: [],
      assumption: 'x',
    }));
    assert.equal(normaliseQuestions(drafts).length, 5);
  });
});

describe('resolveAnswers', () => {
  const questions = [question('q1'), question('q2')];

  it('keeps what the producer wrote', () => {
    const [a] = resolveAnswers(questions, { q1: '  Two units  ' });
    assert.deepEqual(a, { id: 'q1', question: 'Question q1?', answer: 'Two units', assumed: false });
  });

  it('falls back to the assumption for blank, missing or non-string answers', () => {
    const answers = resolveAnswers(questions, { q1: '   ', q2: 42 });
    assert.deepEqual(
      answers.map((a) => [a.answer, a.assumed]),
      [
        ['assume q1', true],
        ['assume q2', true],
      ],
    );
  });

  it('ignores answers to questions that were never asked', () => {
    const answers = resolveAnswers(questions, { q9: 'injected', q1: 'yes' });
    assert.deepEqual(
      answers.map((a) => a.id),
      ['q1', 'q2'],
    );
  });

  it('caps answer length', () => {
    const [a] = resolveAnswers(questions, { q1: 'x'.repeat(2000) });
    assert.equal(a.answer.length, 500);
  });
});

describe('describeClarifications', () => {
  it('is empty when nothing was asked, so prompts are unchanged', () => {
    assert.equal(describeClarifications([]), '');
  });

  it('marks assumptions as assumptions', () => {
    const text = describeClarifications(resolveAnswers([question('q1'), question('q2')], { q1: 'Yes' }));
    assert.match(text, /Question q1\? → Yes/);
    assert.match(text, /Question q2\? → not answered; working assumption: assume q2/);
  });
});
