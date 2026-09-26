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
  locale: string;
  /** What the producer answered when the run paused to ask — empty until then. */
  clarifications: ClarifyAnswer[];
};

// ------------------------------------------------------------ clarification

/** One thing the brief and the script leave open that would change the sheet. */
export type ClarifyQuestion = {
  id: string;
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
  equipmentId: string;
  categorySlug: string;
  brand: string;
  model: string;
  quantity: number;
  rentalDays: number;
  reason: string;
};

export type EquipmentResult = {
  package: PackageItem[];
  rationale: string;
  droppedHallucinatedIds: string[];
};

// ------------------------------------------------------------ DOP matching

export type DopMatch = {
  dopId: string;
  name: string;
  city: string | null;
  score: number;
  reason: string;
  styleTags: string[];
  portfolioLinks: string[];
  dayRate: number | null;
  yearsExperience: number | null;
};

export type DopResult = {
  matches: DopMatch[];
  queryText: string;
  searchedCount: number;
  note: string | null;
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

// ------------------------------------------------------------ final sheet

export type ProductionSheet = {
  sceneSummary: SceneSummary;
  scenes: SceneRequirement[];
  equipment: EquipmentResult;
  dops: DopResult;
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
  | 'clarifying'
  | 'awaiting_input'
  | 'matching_equipment'
  | 'matching_dops'
  | 'pricing'
  | 'reviewing'
  | 'retrying'
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
  | { type: 'done'; projectId: string }
  | { type: 'error'; message: string };

export type ProgressReporter = (event: ProgressEvent) => void;
