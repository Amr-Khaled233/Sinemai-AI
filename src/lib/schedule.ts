import type { CameraMovement, Complexity, IntExt, TimeOfDay } from '@prisma/client';

/**
 * Turns a scene breakdown into a day-by-day shooting schedule.
 *
 * This is the classic first pass an AD does by hand: group scenes that share a
 * location so the unit moves as little as possible, keep night work together so
 * the crew is not flipped between day and night calls, and fill each day up to
 * the configured hours rather than by scene count.
 *
 * Deliberately deterministic and model-free. The hours come from the breakdown
 * the analyst already produced, and a producer holding a schedule needs it to
 * be reproducible, not creative.
 */

export type ScheduleScene = {
  id: string;
  order: number;
  heading: string;
  slug: string | null;
  intExt: IntExt | null;
  timeOfDay: TimeOfDay | null;
  lightingComplexity: Complexity | null;
  cameraMovement: CameraMovement | null;
  estimatedHours: number | null;
  specialRequirements: string[];
};

export type ShootDay = {
  day: number;
  /** DAY, NIGHT or DAWN_DUSK — the call this day is built around. */
  unit: TimeOfDay;
  hours: number;
  locations: string[];
  scenes: ScheduleScene[];
  /** Flags an AD would want to see before committing to the day. */
  warnings: ScheduleWarning[];
};

export type ScheduleWarning =
  | { kind: 'mixed-call'; detail: string }
  | { kind: 'over-hours'; detail: string }
  | { kind: 'company-moves'; detail: string }
  | { kind: 'special'; detail: string };

export type Schedule = {
  days: ShootDay[];
  totalHours: number;
  /** Times the unit changes location across the whole schedule. */
  companyMoves: number;
  unscheduled: ScheduleScene[];
};

const DEFAULT_SCENE_HOURS = 2;

/** Scenes without a parsed location still need a stable grouping key. */
function locationOf(scene: ScheduleScene) {
  return (scene.slug ?? scene.heading).trim().toUpperCase().slice(0, 60) || 'UNKNOWN';
}

function hoursOf(scene: ScheduleScene) {
  const hours = scene.estimatedHours ?? DEFAULT_SCENE_HOURS;
  return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SCENE_HOURS;
}

/** Night and dawn/dusk share a late call, so they schedule together. */
function unitOf(scene: ScheduleScene): TimeOfDay {
  return scene.timeOfDay ?? 'DAY';
}

function isLateCall(unit: TimeOfDay) {
  return unit === 'NIGHT' || unit === 'DAWN_DUSK';
}

export function buildSchedule(
  scenes: ScheduleScene[],
  options: { shootDayHours?: number } = {},
): Schedule {
  const shootDayHours = Math.max(4, options.shootDayHours ?? 10);
  const usable = scenes.filter((scene) => scene.heading.trim().length > 0);

  if (usable.length === 0) {
    return { days: [], totalHours: 0, companyMoves: 0, unscheduled: [] };
  }

  // Group by call first, then by location: a unit that shoots all its night
  // work at one location before moving is the cheapest shape a schedule takes.
  const groups = new Map<string, ScheduleScene[]>();
  for (const scene of usable) {
    const key = `${isLateCall(unitOf(scene)) ? 'LATE' : 'DAY'}::${locationOf(scene)}`;
    const group = groups.get(key) ?? [];
    group.push(scene);
    groups.set(key, group);
  }

  // Day work first, then nights; within that, the biggest locations first, so
  // a long location does not get split across the end of the schedule.
  const ordered = [...groups.entries()].sort(([keyA, a], [keyB, b]) => {
    const lateA = keyA.startsWith('LATE') ? 1 : 0;
    const lateB = keyB.startsWith('LATE') ? 1 : 0;
    if (lateA !== lateB) return lateA - lateB;
    const hoursA = a.reduce((sum, scene) => sum + hoursOf(scene), 0);
    const hoursB = b.reduce((sum, scene) => sum + hoursOf(scene), 0);
    if (hoursA !== hoursB) return hoursB - hoursA;
    return keyA.localeCompare(keyB);
  });

  const days: ShootDay[] = [];
  let current: ShootDay | null = null;

  const openDay = (unit: TimeOfDay) => {
    current = { day: days.length + 1, unit, hours: 0, locations: [], scenes: [], warnings: [] };
    days.push(current);
    return current;
  };

  for (const [key, group] of ordered) {
    const late = key.startsWith('LATE');

    for (const scene of group.sort((a, b) => a.order - b.order)) {
      const hours = hoursOf(scene);
      const unit = unitOf(scene);

      // A new day starts when this one is full, or when the call flips —
      // shooting a day scene after a night scene needs a turnaround the
      // schedule cannot absorb.
      const flips = current !== null && isLateCall(current.unit) !== late;
      const full = current !== null && current.hours + hours > shootDayHours && current.scenes.length > 0;
      if (current === null || flips || full) current = openDay(unit);

      current.scenes.push(scene);
      current.hours = Math.round((current.hours + hours) * 10) / 10;
      const location = locationOf(scene);
      if (!current.locations.includes(location)) current.locations.push(location);
      // A single scene longer than a full day still occupies its own day.
      if (isLateCall(unit) && !isLateCall(current.unit)) current.unit = unit;
    }
  }

  for (const day of days) {
    if (day.locations.length > 2) {
      day.warnings.push({
        kind: 'company-moves',
        detail: `${day.locations.length} locations in one day`,
      });
    }
    if (day.hours > shootDayHours) {
      day.warnings.push({ kind: 'over-hours', detail: `${day.hours}h against a ${shootDayHours}h day` });
    }

    const calls = new Set(day.scenes.map((scene) => (isLateCall(unitOf(scene)) ? 'late' : 'day')));
    if (calls.size > 1) {
      day.warnings.push({ kind: 'mixed-call', detail: 'day and night scenes share this call' });
    }

    const special = [...new Set(day.scenes.flatMap((scene) => scene.specialRequirements))];
    if (special.length) {
      day.warnings.push({ kind: 'special', detail: special.slice(0, 4).join(', ') });
    }
  }

  // A move is any day whose first location differs from the previous day's last.
  let companyMoves = 0;
  for (let index = 1; index < days.length; index += 1) {
    const previous = days[index - 1].locations.at(-1);
    if (previous && days[index].locations[0] !== previous) companyMoves += 1;
  }

  return {
    days,
    totalHours: Math.round(days.reduce((sum, day) => sum + day.hours, 0) * 10) / 10,
    companyMoves,
    unscheduled: [],
  };
}
