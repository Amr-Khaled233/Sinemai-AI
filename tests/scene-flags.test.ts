import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeSceneFlags, MAX_FLAGS, normaliseFlags, sceneFlagHints, type DraftFlag, type FlagSceneInput } from '../src/agents/scene-flags';

const scene = (over: Partial<FlagSceneInput> = {}): FlagSceneInput => ({
  sceneId: 's1',
  order: 1,
  heading: 'INT. KITCHEN - DAY',
  lighting_complexity: 'low',
  lighting_notes: '',
  camera_movement: 'static',
  time_of_day: 'day',
  environment: 'interior',
  special_requirements: [],
  estimated_shoot_hours: 2,
  pageEighths: 8,
  excerpt: '',
  ...over,
});

const draft = (over: Partial<DraftFlag> = {}): DraftFlag => ({
  kind: 'danger',
  severity: 'high',
  scenes: [1],
  title: 'Car chase',
  detail: 'Two cars at speed on a public road.',
  needs: ['Stunt coordinator', 'Road closure permit'],
  ...over,
});

describe('scene flag hints', () => {
  it('says nothing about an ordinary scene', () => {
    assert.deepEqual(sceneFlagHints([scene()]), []);
  });

  it('spots a long scene by pages or by hours', () => {
    assert.match(sceneFlagHints([scene({ pageEighths: 30 })])[0], /long scene — 3\.8 pages/);
    assert.match(sceneFlagHints([scene({ estimated_shoot_hours: 7, pageEighths: null })])[0], /long scene — ~7h/);
  });

  it('spots aerial work, rigs, noted requirements and big night exteriors', () => {
    const hints = sceneFlagHints([
      scene({ order: 2, camera_movement: 'drone' }),
      scene({ order: 3, camera_movement: 'crane/dolly' }),
      scene({ order: 4, special_requirements: ['fire', 'stunt'] }),
      scene({ order: 5, environment: 'exterior', time_of_day: 'night', lighting_complexity: 'high' }),
    ]);
    assert.equal(hints.length, 4);
    assert.match(hints[0], /Sc\. 2.*drone/);
    assert.match(hints[2], /fire, stunt/);
    assert.match(hints[3], /night exterior/);
  });
});

describe('normalising flags', () => {
  it('drops scene numbers the script does not have, and flags left with none', () => {
    const flags = normaliseFlags([draft({ scenes: [1, 99] }), draft({ scenes: [42], title: 'Ghost' })], [1, 2, 3]);
    assert.equal(flags.length, 1);
    assert.deepEqual(flags[0].scenes, [1]);
  });

  it('merges repeats and puts the most serious first', () => {
    const flags = normaliseFlags(
      [
        draft({ severity: 'low', kind: 'long_scene', scenes: [3], title: 'Long dinner' }),
        draft({ scenes: [2] }),
        draft({ scenes: [2], title: 'Same chase again' }),
      ],
      [1, 2, 3],
    );
    assert.deepEqual(
      flags.map((flag) => [flag.id, flag.kind, flag.severity]),
      [
        ['f1', 'danger', 'high'],
        ['f2', 'long_scene', 'low'],
      ],
    );
  });

  it('falls back to safe values for an unknown kind or severity', () => {
    const [flag] = normaliseFlags(
      [draft({ kind: 'explosion' as DraftFlag['kind'], severity: 'extreme' as DraftFlag['severity'] })],
      [1],
    );
    assert.equal(flag.kind, 'other');
    assert.equal(flag.severity, 'medium');
  });

  it('caps the list so the producer reads all of it', () => {
    const many = Array.from({ length: 20 }, (_, index) => draft({ scenes: [index + 1], title: `Flag ${index}` }));
    const orders = Array.from({ length: 20 }, (_, index) => index + 1);
    assert.equal(normaliseFlags(many, orders).length, MAX_FLAGS);
  });

  it('describes the flags for the agents that come after', () => {
    const text = describeSceneFlags(normaliseFlags([draft()], [1]));
    assert.match(text, /\[high\] danger — Sc\. 1: Car chase\. .*Needs: Stunt coordinator; Road closure permit\./);
    assert.equal(describeSceneFlags([]), '');
  });
});
