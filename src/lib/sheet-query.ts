import { Prisma } from '@prisma/client';

/**
 * The scene fields a production sheet needs, in one place.
 *
 * Four call sites selected these by hand — the project page, the shared page and
 * both exports — and the casts the sheet components use to accept them meant a
 * missing field compiled fine and showed up as an empty column instead. The
 * schedule needs `slug` to group by location, so a copy that forgot it produced
 * a schedule with every scene in its own unit.
 */
export const sheetSceneSelect = {
  id: true,
  order: true,
  heading: true,
  slug: true,
  intExt: true,
  timeOfDay: true,
  lightingComplexity: true,
  lightingNotes: true,
  cameraMovement: true,
  estimatedHours: true,
  specialRequirements: true,
} satisfies Prisma.SceneSelect;

/** Scenes in shooting order, selected for the sheet. */
export const sheetScenesArg = {
  orderBy: { order: 'asc' },
  select: sheetSceneSelect,
} satisfies Prisma.Script$scenesArgs;
