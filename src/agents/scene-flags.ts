import { SCENE_FLAG_KINDS, type SceneFlag, type SceneFlagKind, type SceneRequirement } from './types';

/**
 * The pure half of the scene-flag step — no model, no database — so what code
 * spots on its own and how the model's flags are cleaned up can be tested.
 */

export const MAX_FLAGS = 12;

/** Eight eighths make a script page; a scene over three pages is a long one. */
const LONG_SCENE_EIGHTHS = 24;
const LONG_SCENE_HOURS = 6;

export type FlagSceneInput = SceneRequirement & {
  pageEighths: number | null;
  /** The opening of the scene's action lines, for what the heading does not say. */
  excerpt: string;
};

/** What the model submits through flagScenes, before ids are assigned. */
export type DraftFlag = Omit<SceneFlag, 'id'>;

/**
 * What code can see without reading the action: long scenes, aerial and rigged
 * camera work, special requirements the breakdown already noted. Handed to the
 * agent as hints; it decides what is worth telling the producer.
 */
export function sceneFlagHints(scenes: FlagSceneInput[]): string[] {
  const hints: string[] = [];
  for (const scene of scenes) {
    const label = `Sc. ${scene.order} (${scene.heading})`;
    const long =
      (scene.pageEighths ?? 0) >= LONG_SCENE_EIGHTHS || scene.estimated_shoot_hours >= LONG_SCENE_HOURS;
    if (long) {
      const pages = scene.pageEighths ? `${(scene.pageEighths / 8).toFixed(1)} pages, ` : '';
      hints.push(`${label}: long scene — ${pages}~${scene.estimated_shoot_hours}h to shoot.`);
    }
    if (scene.camera_movement === 'drone') hints.push(`${label}: aerial shot — drone, pilot and a flight permit.`);
    if (scene.camera_movement === 'crane/dolly') hints.push(`${label}: crane or dolly move.`);
    if (scene.special_requirements.length) {
      hints.push(`${label}: special requirements — ${scene.special_requirements.join(', ')}.`);
    }
    if (scene.environment === 'exterior' && scene.time_of_day === 'night' && scene.lighting_complexity === 'high') {
      hints.push(`${label}: complex night exterior — large lighting setup and power.`);
    }
  }
  return hints;
}

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * Keeps only flags that point at real scenes, merges repeats, puts the most
 * serious first and caps the list so the producer reads all of it.
 */
export function normaliseFlags(drafts: DraftFlag[], sceneOrders: Iterable<number>): SceneFlag[] {
  const valid = new Set(sceneOrders);
  const seen = new Set<string>();
  const kept: Omit<SceneFlag, 'id'>[] = [];

  for (const draft of drafts) {
    const kind: SceneFlagKind = (SCENE_FLAG_KINDS as readonly string[]).includes(draft.kind) ? draft.kind : 'other';
    const scenes = [...new Set(draft.scenes.map(Math.round).filter((order) => valid.has(order)))].sort((a, b) => a - b);
    const title = draft.title.trim();
    if (scenes.length === 0 || !title) continue;

    const key = `${kind}:${scenes.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    kept.push({
      kind,
      severity: draft.severity in SEVERITY_ORDER ? draft.severity : 'medium',
      scenes,
      title,
      detail: draft.detail.trim(),
      needs: [...new Set(draft.needs.map((need) => need.trim()).filter(Boolean))].slice(0, 6),
    });
  }

  return kept
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.scenes[0] - b.scenes[0])
    .slice(0, MAX_FLAGS)
    .map((flag, index) => ({ id: `f${index + 1}`, ...flag }));
}

/** The block every later agent reads, so the flagged scenes are planned for, not rediscovered. */
export function describeSceneFlags(flags: SceneFlag[]): string {
  if (flags.length === 0) return '';
  return [
    'Scenes that need special attention (already flagged to the producer):',
    ...flags.map(
      (flag) =>
        `- [${flag.severity}] ${flag.kind} — Sc. ${flag.scenes.join(', ')}: ${flag.title}. ${flag.detail}${
          flag.needs.length ? ` Needs: ${flag.needs.join('; ')}.` : ''
        }`,
    ),
  ].join('\n');
}
