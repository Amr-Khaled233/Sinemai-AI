import type {
  AgentName,
  BudgetTier,
  CameraMovement,
  Complexity,
  IntExt,
  ProjectType,
  TimeOfDay,
} from '@prisma/client';

// ------------------------------------------------------------ project context

export type ProjectBrief = {
  projectId: string;
  name: string;
  type: ProjectType;
  budgetTier: BudgetTier;
  visualStyleTags: string[];
  city: string;
  shootStartDate: Date | null;
  shootEndDate: Date | null;
  synopsis: string | null;
  /** The producer's own budget range in SAR, when they gave one. */
  budgetMin: number | null;
  budgetMax: number | null;
  locale: string;
  /** What the producer answered when the run paused to ask — empty until then. */
  clarifications: ClarifyAnswer[];
  /** Scenes flagged for attention after the breakdown — empty until then. */
  sceneFlags: SceneFlag[];
};

// ------------------------------------------------------------ scenes that need attention

/** Why a scene stands out from the rest of the shoot. */
export const SCENE_FLAG_KINDS = [
  'danger',
  'special_camera',
  'long_scene',
  'special_location',
  'vfx',
  'crowd',
  'animals',
  'water',
  'vehicles',
  'weather',
  'children',
  'permit',
  'other',
] as const;

export type SceneFlagKind = (typeof SCENE_FLAG_KINDS)[number];

/**
 * A scene (or a run of scenes) the producer should know about before the
 * shoot is planned: dangerous action, a special camera just for that moment, a
 * very long scene, a location that has to be found and booked, and so on.
 */
export type SceneFlag = {
  id: string;
  kind: SceneFlagKind;
  severity: 'high' | 'medium' | 'low';
  /** Scene numbers as the script counts them. */
  scenes: number[];
  title: string;
  /** What happens in the scene and why it matters for the shoot. */
  detail: string;
  /** What it will take: gear, people, permits, preparation. */
  needs: string[];
};

// ------------------------------------------------------------ clarification

/** One thing the brief and the script leave open that would change the sheet. */
/** What a question is about; budget and location answers are written back to the project. */
export type ClarifyTopic = 'budget' | 'release' | 'schedule' | 'location' | 'cast' | 'scene' | 'other';

export type ClarifyQuestion = {
  id: string;
  topic: ClarifyTopic;
  question: string;
  /** What the answer changes — equipment, crew, budget — in one line. */
  why: string;
  /** Suggested answers; the producer can still write their own. */
  options: string[];
  /** What the run goes with if the producer skips the question. */
  assumption: string;
};

export type ClarifyAnswer = {
  id: string;
  question: string;
  answer: string;
  /** True when the producer skipped it and the assumption was used instead. */
  assumed: boolean;
};

// ------------------------------------------------------------ script analyst

export type SceneRequirement = {
  sceneId: string;
  order: number;
  heading: string;
  lighting_complexity: 'low' | 'medium' | 'high';
  lighting_notes: string;
  camera_movement: 'static' | 'handheld' | 'steadicam/gimbal' | 'crane/dolly' | 'drone';
  time_of_day: 'day' | 'night' | 'dawn/dusk';
  environment: 'interior' | 'exterior';
  special_requirements: string[];
  estimated_shoot_hours: number;
};

/** Aggregate every downstream agent reasons over — computed in code, not by an LLM. */
export type SceneSummary = {
  sceneCount: number;
  totalHours: number;
  shootDays: number;
  pageCount: number;
  nightScenePct: number;
  exteriorScenePct: number;
  highComplexityPct: number;
  lightingMix: Record<Complexity, number>;
  movementMix: Record<CameraMovement, number>;
  timeMix: Record<TimeOfDay, number>;
  environmentMix: Record<IntExt, number>;
  specialRequirements: string[];
  dominantLightingNotes: string[];
};

// ------------------------------------------------------------ equipment

export type CatalogItem = {
  id: string;
  categorySlug: string;
  categoryNameEn: string;
  brand: string;
  model: string;
  summaryEn: string;
  specs: Record<string, unknown>;
  budgetTier: BudgetTier[];
  suitableLightingComplexity: Complexity[];
  suitableMovementTypes: CameraMovement[];
  dayNightSuitability: 'DAY' | 'NIGHT' | 'BOTH';
  specialCapabilities: string[];
  indicativeDayRate: number | null;
  vendorCount: number;
  bestDayRate: number | null;
};

export type PackageItem = {
  /** A catalog id, or `market:…` for gear the platform does not list. */
  equipmentId: string;
  categorySlug: string;
  brand: string;
  model: string;
  quantity: number;
  rentalDays: number;
  reason: string;
  /** Market gear only: the assistant's estimate of a Saudi rental day rate, in SAR. */
  estimatedDayRate?: number | null;
};

export const MARKET_PREFIX = 'market:';

/** Gear chosen from the wider market rather than the platform's catalog. */
export function isMarketItem(item: { equipmentId: string }) {
  return item.equipmentId.startsWith(MARKET_PREFIX);
}

export function marketId(brand: string, model: string) {
  const slug = `${brand} ${model}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${MARKET_PREFIX}${slug || 'item'}`;
}

export type EquipmentResult = {
  package: PackageItem[];
  rationale: string;
  droppedHallucinatedIds: string[];
};

// ------------------------------------------------------------ vendors + budget

export type VendorLine = {
  equipmentId: string;
  brand: string;
  model: string;
  quantity: number;
  rentalDays: number;
  dailyRate: number;
  weeklyRate: number | null;
  lineTotal: number;
  available: boolean;
};

export type VendorMatch = {
  vendorId: string;
  companyName: string;
  city: string;
  verified: boolean;
  coveragePct: number;
  itemsCovered: number;
  subtotal: number;
  contactEmail: string | null;
  phone: string | null;
  items: VendorLine[];
};

export type CrewLine = {
  roleSlug: string;
  labelEn: string;
  labelAr: string;
  headcount: number;
  dayRate: number;
  days: number;
  total: number;
};

export type BudgetBreakdown = {
  shootDays: number;
  equipmentRental: number;
  equipmentUncovered: number;
  crewTotal: number;
  crewBreakdown: CrewLine[];
  contingencyPct: number;
  contingency: number;
  currency: string;
};

export type VendorBudgetResult = {
  vendors: VendorMatch[];
  budget: BudgetBreakdown;
  low: number;
  mid: number;
  high: number;
  notes: string[];
  uncoveredEquipment: Array<{ equipmentId: string; brand: string; model: string; fallbackDayRate: number | null }>;
};

// ------------------------------------------------------------ critic

export type CriticIssue = {
  agent: Exclude<AgentName, 'ORCHESTRATOR' | 'CRITIC'>;
  severity: 'info' | 'warning' | 'blocker';
  problem: string;
  suggestion: string;
};

export type CriticResult = {
  passed: boolean;
  issues: CriticIssue[];
  summary: string;
};

// ------------------------------------------------------------ advisor

/**
 * The advisor's read beyond the catalog. Everything here is a suggestion from
 * the model and the web — people to approach, market prices to confirm — not a
 * priced fact from the platform's own data. Each list carries several options.
 */
export type Advice = {
  shootDuration: { days: number; rangeLow: number; rangeHigh: number; rationale: string };
  budgetFit: { verdict: 'within' | 'over' | 'under' | 'unknown'; note: string };
  costlyScenes: Array<{
    scenes: string;
    whyCostly: string;
    risk: 'safety' | 'cost' | 'both';
    options: string[];
  }>;
  directors: Array<{ name: string; knownFor: string; why: string }>;
  cast: Array<{ role: string; suggestions: Array<{ name: string; why: string }> }>;
  equipmentIdeas: Array<{ item: string; why: string; approxDayRateSar: number | null }>;
  savings: Array<{ idea: string; estimatedSavingSar: number | null }>;
  sources: Array<{ title: string; url: string }>;
};

/** What the research stage hands the structuring stage. */
export type AdviceNotes = { text: string; sources: Array<{ title: string; url: string }> };

// ------------------------------------------------------------ final sheet

export type ProductionSheet = {
  sceneSummary: SceneSummary;
  scenes: SceneRequirement[];
  equipment: EquipmentResult;
  vendorBudget: VendorBudgetResult;
  critic: CriticResult;
  rationaleText: string;
  modelVersions: Record<string, string>;
};

// ------------------------------------------------------------ progress stream

export type ProgressStage =
  | 'queued'
  | 'parsing'
  | 'analyzing_scenes'
  | 'flagging_scenes'
  | 'clarifying'
  | 'awaiting_input'
  | 'matching_equipment'
  | 'pricing'
  | 'reviewing'
  | 'retrying'
  | 'researching'
  | 'advising'
  | 'saving'
  | 'done'
  | 'error';

export type ProgressEvent =
  | {
      type: 'checkpoint';
      done: boolean;
      failed: boolean;
      stage: string;
      pct: number;
      /** Another client holds the lease; watch rather than drive. */
      busy?: boolean;
      /** The run is paused on questions only the producer can answer. */
      awaiting?: boolean;
    }
  | { type: 'stage'; stage: ProgressStage; detail?: string; pct: number }
  | { type: 'log'; message: string }
  | { type: 'scenes'; count: number }
  | { type: 'questions'; questions: ClarifyQuestion[] }
  | { type: 'flags'; flags: SceneFlag[] }
  | { type: 'done'; projectId: string }
  | { type: 'error'; message: string };

export type ProgressReporter = (event: ProgressEvent) => void;
