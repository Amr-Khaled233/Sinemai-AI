import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, type ScheduleScene } from '../src/lib/schedule';

const scene = (over: Partial<ScheduleScene> & { order: number }): ScheduleScene => ({
  id: `s${over.order}`,
  heading: 'INT. WAREHOUSE - DAY',
  slug: 'WAREHOUSE',
  intExt: 'INTERIOR',
  timeOfDay: 'DAY',
  lightingComplexity: 'MEDIUM',
  cameraMovement: 'STATIC',
  estimatedHours: 4,
  specialRequirements: [],
  ...over,
});

describe('shooting schedule', () => {
  it('fills a day by hours, not by scene count', () => {
    const schedule = buildSchedule(
      [scene({ order: 1 }), scene({ order: 2 }), scene({ order: 3 })],
      { shootDayHours: 10 },
    );
    // 4 + 4 fits; the third scene would make 12, so it starts a second day.
    assert.equal(schedule.days.length, 2);
    assert.equal(schedule.days[0].scenes.length, 2);
    assert.equal(schedule.days[0].hours, 8);
  });

  it('keeps scenes that share a location on the same day', () => {
    const schedule = buildSchedule(
      [
        scene({ order: 1, slug: 'CAFE', estimatedHours: 3 }),
        scene({ order: 2, slug: 'ROOFTOP', estimatedHours: 3 }),
        scene({ order: 3, slug: 'CAFE', estimatedHours: 3 }),
      ],
      { shootDayHours: 10 },
    );
    const firstDay = schedule.days[0].scenes.map((item) => item.slug);
    // The two CAFE scenes are adjacent despite being scenes 1 and 3.
    assert.deepEqual(firstDay.slice(0, 2), ['CAFE', 'CAFE']);
  });

  it('never mixes a day call with a night call', () => {
    const schedule = buildSchedule(
      [
        scene({ order: 1, timeOfDay: 'DAY', estimatedHours: 3 }),
        scene({ order: 2, timeOfDay: 'NIGHT', slug: 'ALLEY', estimatedHours: 3 }),
      ],
      { shootDayHours: 10 },
    );
    assert.equal(schedule.days.length, 2);
    assert.equal(schedule.days[0].unit, 'DAY');
    assert.equal(schedule.days[1].unit, 'NIGHT');
  });

  it('groups dawn and night together, since both are a late call', () => {
    const schedule = buildSchedule(
      [
        scene({ order: 1, timeOfDay: 'NIGHT', slug: 'ALLEY', estimatedHours: 3 }),
        scene({ order: 2, timeOfDay: 'DAWN_DUSK', slug: 'ALLEY', estimatedHours: 3 }),
      ],
      { shootDayHours: 10 },
    );
    assert.equal(schedule.days.length, 1);
  });

  it('schedules day work before night work', () => {
    const schedule = buildSchedule(
      [
        scene({ order: 1, timeOfDay: 'NIGHT', slug: 'ALLEY' }),
        scene({ order: 2, timeOfDay: 'DAY', slug: 'CAFE' }),
      ],
      { shootDayHours: 10 },
    );
    assert.equal(schedule.days[0].unit, 'DAY');
  });

  it('flags a day that moves between more than two locations', () => {
    const schedule = buildSchedule(
      [
        scene({ order: 1, slug: 'A', estimatedHours: 2 }),
        scene({ order: 2, slug: 'B', estimatedHours: 2 }),
        scene({ order: 3, slug: 'C', estimatedHours: 2 }),
      ],
      { shootDayHours: 12 },
    );
    const warnings = schedule.days[0].warnings.map((warning) => warning.kind);
    assert.ok(warnings.includes('company-moves'));
  });

  it('surfaces special requirements on the day they land', () => {
    const schedule = buildSchedule(
      [scene({ order: 1, specialRequirements: ['vehicle mount', 'rain'] })],
      { shootDayHours: 10 },
    );
    const special = schedule.days[0].warnings.find((warning) => warning.kind === 'special');
    assert.ok(special?.detail.includes('vehicle mount'));
  });

  it('gives a scene longer than a full day its own day rather than dropping it', () => {
    const schedule = buildSchedule(
      [scene({ order: 1, estimatedHours: 16 }), scene({ order: 2, estimatedHours: 2 })],
      { shootDayHours: 10 },
    );
    assert.equal(schedule.days[0].scenes.length, 1);
    assert.ok(schedule.days[0].warnings.some((warning) => warning.kind === 'over-hours'));
    // And the short scene still gets scheduled.
    assert.equal(schedule.days.length, 2);
  });

  it('falls back to a default when a scene has no estimate', () => {
    const schedule = buildSchedule([scene({ order: 1, estimatedHours: null })], { shootDayHours: 10 });
    assert.ok(schedule.days[0].hours > 0);
  });

  it('schedules every scene exactly once', () => {
    const scenes = Array.from({ length: 24 }, (_, index) =>
      scene({
        order: index + 1,
        slug: ['CAFE', 'ALLEY', 'ROOFTOP'][index % 3],
        timeOfDay: index % 4 === 0 ? 'NIGHT' : 'DAY',
        estimatedHours: 3,
      }),
    );
    const schedule = buildSchedule(scenes, { shootDayHours: 10 });
    const scheduled = schedule.days.flatMap((day) => day.scenes.map((item) => item.id));
    assert.equal(scheduled.length, 24);
    assert.equal(new Set(scheduled).size, 24);
  });

  it('returns an empty schedule rather than throwing on no scenes', () => {
    const schedule = buildSchedule([], { shootDayHours: 10 });
    assert.deepEqual(schedule.days, []);
    assert.equal(schedule.totalHours, 0);
  });
});
