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
  locale: 'en',
  clarifications: [],
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
  question: `Question ${id}?`,
  why: 'Changes the package.',
  options: [],
  assumption: `assume ${id}`,
  ...over,
});

describe('detectGaps', () => {
  it('finds nothing in a complete brief', () => {
    assert.deepEqual(detectGaps(brief(), summary()), []);
  });

  it('flags missing shoot dates', () => {
    const gaps = detectGaps(brief({ shootStartDate: null, shootEndDate: null }), summary());
    assert.equal(gaps.length, 1);
    assert.match(gaps[0], /No shoot dates/);
  });

  it('flags a shoot window shorter than the estimated shoot days', () => {
    const gaps = detectGaps(
      brief({ shootStartDate: new Date('2026-10-01'), shootEndDate: new Date('2026-10-02') }),
      summary({ shootDays: 4 }),
    );
    assert.equal(gaps.length, 1);
    assert.match(gaps[0], /2 day\(s\).*4 shoot day\(s\)/);
  });

  it('counts the window inclusively', () => {
    const exact = brief({ shootStartDate: new Date('2026-10-01'), shootEndDate: new Date('2026-10-03') });
    assert.deepEqual(detectGaps(exact, summary({ shootDays: 3 })), []);
  });

  it('flags no style and no synopsis only when both are missing', () => {
    assert.deepEqual(detectGaps(brief({ visualStyleTags: [] }), summary()), []);
    const gaps = detectGaps(brief({ visualStyleTags: [], synopsis: null }), summary());
    assert.equal(gaps.length, 1);
    assert.match(gaps[0], /visual style/);
  });

  it('flags drone work and special requirements', () => {
    const gaps = detectGaps(
      brief(),
      summary({
        movementMix: { STATIC: 6, HANDHELD: 2, STEADICAM_GIMBAL: 0, CRANE_DOLLY: 0, DRONE: 2 },
        specialRequirements: ['underwater'],
      }),
    );
    assert.equal(gaps.length, 2);
    assert.match(gaps[0], /2 scene\(s\) read as drone/);
    assert.match(gaps[1], /underwater/);
  });
});

describe('normaliseQuestions', () => {
  it('assigns stable ids, trims text and de-duplicates options', () => {
    const [q] = normaliseQuestions([
      { question: '  Night or day?  ', why: ' lights ', options: ['Night', ' Night ', '', 'Day'], assumption: ' Night ' },
    ]);
    assert.deepEqual(q, {
      id: 'q1',
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
    assert.equal(normaliseQuestions(drafts).length, 4);
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
