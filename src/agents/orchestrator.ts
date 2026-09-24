import { generateText } from 'ai';
import { AgentName, AgentRunStatus, AnalysisStage, ProjectStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createRunContext, finishRun, model, MODELS, startRun } from './runtime';
import { loadSceneRequirements, runScriptAnalystStep, summariseScenes } from './script-analyst';
import { runEquipmentAgent } from './equipment-agent';
import { runDopAgent } from './dop-agent';
import { runVendorBudgetAgent } from './vendor-budget-agent';
import { runCriticAgent } from './critic-agent';
import { languageDirective, languageName } from './language';
import type {
  CriticIssue,
  CriticResult,
  DopResult,
  EquipmentResult,
  ProductionSheet,
  ProgressReporter,
  ProgressStage,
  ProjectBrief,
  SceneSummary,
  VendorBudgetResult,
} from './types';

export const ORCHESTRATOR_SYSTEM = `You are the supervising producer of an automated breakdown. You have no database access: you delegate to specialist agents and then write the short executive summary that opens the Production & Equipment Sheet.

Write 3–5 sentences for the director/producer who will act on this sheet. Lead with what the script demands, then why this package and these people answer it, then the money and the single biggest caveat. Cite concrete numbers from the breakdown. No bullet points, no marketing language, no invented facts.`;

/**
 * Agent 1 — Orchestrator.
 *
 * Owns execution order and final assembly, but runs as a **resumable state
 * machine** rather than one long call: each step does one unit of work and
 * checkpoints to `AnalysisState`. A request executes as many steps as it can
 * inside its time budget and then returns; the client calls again to continue.
 *
 * That keeps every invocation comfortably inside a 60s serverless limit while
 * the graph itself is unchanged — equipment and DOP matching still run
 * concurrently, vendor pricing still waits for the package, and the critic
 * still gets one targeted retry per agent.
 */

const STAGE_PROGRESS: Record<AnalysisStage, { pct: number; stage: ProgressStage }> = {
  PARSE: { pct: 8, stage: 'parsing' },
  SCENES: { pct: 20, stage: 'analyzing_scenes' },
  EQUIPMENT: { pct: 50, stage: 'matching_equipment' },
  DOPS: { pct: 60, stage: 'matching_dops' },
  VENDOR_BUDGET: { pct: 70, stage: 'pricing' },
  CRITIC: { pct: 80, stage: 'reviewing' },
  RETRY: { pct: 86, stage: 'retrying' },
  ASSEMBLE: { pct: 94, stage: 'saving' },
  DONE: { pct: 100, stage: 'done' },
  FAILED: { pct: 100, stage: 'error' },
};

export type StepOutcome = {
  done: boolean;
  stage: AnalysisStage;
  pct: number;
  failed?: boolean;
  /** Another client already holds the lease and is advancing this run. */
  busy?: boolean;
};

/**
 * How long a single advance request may hold the run before another client is
 * allowed to take over. Comfortably longer than one request's time budget, so
 * a healthy driver never loses its own lease mid-step.
 */
const LEASE_MS = 90_000;

/**
 * Claims the right to advance this run.
 *
 * Without it, a producer with the project open in two tabs — or who reloaded
 * while a run was in flight — would have both clients executing the same step,
 * duplicating agent runs and paying for the model calls twice. The claim is a
 * conditional update, so the database decides the winner.
 */
async function claimLease(projectId: string, owner: string) {
  const now = new Date();
  const { count } = await prisma.analysisState.updateMany({
    where: {
      projectId,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }, { leaseOwner: owner }],
    },
    data: { leaseOwner: owner, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return count > 0;
}

async function releaseLease(projectId: string, owner: string) {
  await prisma.analysisState
    .updateMany({
      where: { projectId, leaseOwner: owner },
      data: { leaseOwner: null, leaseUntil: null },
    })
    .catch(() => {
      // A lost release just means the lease expires on its own.
    });
}

/** Starts a fresh run, discarding any half-finished state for this project. */
export async function beginAnalysis(projectId: string, locale: string) {
  const state = {
    stage: AnalysisStage.PARSE,
    locale,
    sceneCursor: 0,
    sceneTotal: 0,
    summary: Prisma.DbNull,
    equipment: Prisma.DbNull,
    dops: Prisma.DbNull,
    vendorBudget: Prisma.DbNull,
    critic: Prisma.DbNull,
    retriedAgents: [],
    criticRound: 0,
    errorText: null,
    leaseOwner: null,
    leaseUntil: null,
    startedAt: new Date(),
  };

  await prisma.$transaction([
    prisma.analysisState.upsert({
      where: { projectId },
      create: { projectId, ...state },
      update: state,
    }),
    prisma.project.update({ where: { id: projectId }, data: { status: ProjectStatus.ANALYZING } }),
  ]);
}

/**
 * Runs analysis steps until the time budget is spent or the run finishes.
 * `budgetMs` is deliberately below the function's `maxDuration` so the response
 * always makes it back to the client with a resume point.
 */
export async function advanceAnalysis(
  projectId: string,
  report: ProgressReporter,
  options: { budgetMs?: number; owner?: string } = {},
): Promise<StepOutcome> {
  const budgetMs = options.budgetMs ?? 45_000;
  const owner = options.owner ?? `req-${Math.random().toString(36).slice(2, 10)}`;
  const startedAt = Date.now();

  const state = await prisma.analysisState.findUnique({
    where: { projectId },
    select: { stage: true, sceneCursor: true, sceneTotal: true },
  });
  if (!state) throw new Error('ANALYSIS_NOT_STARTED');
  if (state.stage === AnalysisStage.DONE) return { done: true, stage: state.stage, pct: 100 };
  if (state.stage === AnalysisStage.FAILED) {
    return { done: true, stage: state.stage, pct: 100, failed: true };
  }

  // Someone else is driving: report where the run is and let the caller watch.
  if (!(await claimLease(projectId, owner))) {
    const progress = STAGE_PROGRESS[state.stage];
    report({ type: 'stage', stage: progress.stage, pct: progress.pct });
    return { done: false, stage: state.stage, pct: progress.pct, busy: true };
  }

  try {
    let outcome: StepOutcome = { done: false, stage: state.stage, pct: 0 };
    do {
      outcome = await runSingleStep(projectId, report);
      if (outcome.done || outcome.failed) break;
      // Renew while we are still making progress, so a long run keeps its lease.
      await claimLease(projectId, owner);
      // Leave room for one more step of the size we have been seeing.
    } while (Date.now() - startedAt < budgetMs);

    return outcome;
  } finally {
    await releaseLease(projectId, owner);
  }
}

/** One unit of work. Everything it produces is checkpointed before it returns. */
async function runSingleStep(projectId: string, report: ProgressReporter): Promise<StepOutcome> {
  const state = await prisma.analysisState.findUnique({ where: { projectId } });
  if (!state) throw new Error('ANALYSIS_NOT_STARTED');
  if (state.stage === AnalysisStage.DONE) return { done: true, stage: state.stage, pct: 100 };
  if (state.stage === AnalysisStage.FAILED) {
    return { done: true, stage: state.stage, pct: 100, failed: true };
  }

  const brief = await loadBrief(projectId, state.locale);
  const ctx = createRunContext(projectId, report);
  const progress = STAGE_PROGRESS[state.stage];

  try {
    switch (state.stage) {
      // ---- 1. deterministic segmentation
      case AnalysisStage.PARSE: {
        report({ type: 'stage', stage: 'parsing', pct: progress.pct, detail: brief.name });
        const parsed = await runScriptAnalystStep(ctx, brief, { phase: 'parse' });
        report({ type: 'scenes', count: parsed.sceneTotal });
        await save(projectId, { stage: AnalysisStage.SCENES, sceneTotal: parsed.sceneTotal, sceneCursor: 0 });
        return { done: false, stage: AnalysisStage.SCENES, pct: STAGE_PROGRESS.SCENES.pct };
      }

      // ---- 2. one batch of scenes per step, so a feature script resumes cleanly
      case AnalysisStage.SCENES: {
        const batch = await runScriptAnalystStep(ctx, brief, {
          phase: 'batch',
          cursor: state.sceneCursor,
        });

        const done = batch.nextCursor === null;
        const pct = 20 + Math.round((batch.analysed / Math.max(batch.sceneTotal, 1)) * 28);
        report({
          type: 'stage',
          stage: 'analyzing_scenes',
          pct,
          detail: `${batch.analysed}/${batch.sceneTotal}`,
        });

        if (!done) {
          await save(projectId, { sceneCursor: batch.nextCursor ?? 0, sceneTotal: batch.sceneTotal });
          return { done: false, stage: AnalysisStage.SCENES, pct };
        }

        const requirements = await loadSceneRequirements(projectId);
        if (requirements.length === 0) throw new Error('NO_SCENES_ANALYSED');
        const summary = await summariseScenes(projectId, requirements);
        await save(projectId, {
          stage: AnalysisStage.EQUIPMENT,
          sceneCursor: batch.sceneTotal,
          summary: summary as unknown as Prisma.InputJsonValue,
        });
        return { done: false, stage: AnalysisStage.EQUIPMENT, pct: STAGE_PROGRESS.EQUIPMENT.pct };
      }

      // ---- 3. equipment and DOP matching, concurrently
      case AnalysisStage.EQUIPMENT: {
        const summary = readJson<SceneSummary>(state.summary);
        if (!summary) throw new Error('MISSING_SCENE_SUMMARY');
        report({ type: 'log', message: 'Matching equipment and cinematographers' });

        const [equipmentSettled, dopsSettled] = await Promise.allSettled([
          runEquipmentAgent(ctx, brief, summary),
          runDopAgent(ctx, brief, summary),
        ]);

        if (equipmentSettled.status === 'rejected') throw equipmentSettled.reason;

        // A DOP failure degrades the sheet; it does not sink it.
        const dops: DopResult =
          dopsSettled.status === 'fulfilled'
            ? dopsSettled.value
            : {
                matches: [],
                queryText: '',
                searchedCount: 0,
                note: 'Cinematographer matching failed for this run; the rest of the sheet is unaffected.',
              };

        await save(projectId, {
          stage: AnalysisStage.VENDOR_BUDGET,
          equipment: equipmentSettled.value as unknown as Prisma.InputJsonValue,
          dops: dops as unknown as Prisma.InputJsonValue,
        });
        return { done: false, stage: AnalysisStage.VENDOR_BUDGET, pct: STAGE_PROGRESS.VENDOR_BUDGET.pct };
      }

      // DOPS is only reached when a retry re-runs matching on its own.
      case AnalysisStage.DOPS: {
        const summary = readJson<SceneSummary>(state.summary);
        if (!summary) throw new Error('MISSING_SCENE_SUMMARY');
        const dops = await runDopAgent(ctx, brief, summary);
        await save(projectId, {
          stage: AnalysisStage.VENDOR_BUDGET,
          dops: dops as unknown as Prisma.InputJsonValue,
        });
        return { done: false, stage: AnalysisStage.VENDOR_BUDGET, pct: STAGE_PROGRESS.VENDOR_BUDGET.pct };
      }

      // ---- 4. vendors + budget (needs the package)
      case AnalysisStage.VENDOR_BUDGET: {
        const summary = readJson<SceneSummary>(state.summary);
        const equipment = readJson<EquipmentResult>(state.equipment);
        if (!summary || !equipment) throw new Error('MISSING_EQUIPMENT_STATE');

        const vendorBudget = await runVendorBudgetAgent(ctx, brief, summary, equipment);
        await save(projectId, {
          stage: AnalysisStage.CRITIC,
          vendorBudget: vendorBudget as unknown as Prisma.InputJsonValue,
        });
        return { done: false, stage: AnalysisStage.CRITIC, pct: STAGE_PROGRESS.CRITIC.pct };
      }

      // ---- 5. review
      case AnalysisStage.CRITIC: {
        const parts = readParts(state);
        const critic = await runCriticAgent(ctx, brief, parts, { attempt: state.criticRound + 1 });

        const blockers = critic.issues.filter((issue) => issue.severity === 'blocker');
        const retryable = blockers.find(
          (issue) => issue.agent !== 'SCRIPT_ANALYST' && !state.retriedAgents.includes(issue.agent),
        );

        // SCRIPT_ANALYST is never retried here: re-running the breakdown would
        // invalidate the equipment and pricing built on top of it, so its
        // blockers are surfaced to the producer instead.
        const nextStage = retryable && state.criticRound < 2 ? AnalysisStage.RETRY : AnalysisStage.ASSEMBLE;

        await save(projectId, {
          stage: nextStage,
          critic: critic as unknown as Prisma.InputJsonValue,
          criticRound: state.criticRound + 1,
        });
        return { done: false, stage: nextStage, pct: STAGE_PROGRESS[nextStage].pct };
      }

      // ---- 6. one targeted retry per agent, then review again
      case AnalysisStage.RETRY: {
        const critic = readJson<CriticResult>(state.critic);
        const summary = readJson<SceneSummary>(state.summary);
        const equipment = readJson<EquipmentResult>(state.equipment);
        if (!critic || !summary || !equipment) throw new Error('MISSING_CRITIC_STATE');

        const blocker = critic.issues.find(
          (issue) =>
            issue.severity === 'blocker' &&
            issue.agent !== 'SCRIPT_ANALYST' &&
            !state.retriedAgents.includes(issue.agent),
        );

        if (!blocker) {
          await save(projectId, { stage: AnalysisStage.ASSEMBLE });
          return { done: false, stage: AnalysisStage.ASSEMBLE, pct: STAGE_PROGRESS.ASSEMBLE.pct };
        }

        report({ type: 'stage', stage: 'retrying', pct: progress.pct, detail: blocker.agent });
        const flag = `${blocker.problem} ${blocker.suggestion}`;
        const retriedAgents = [...state.retriedAgents, blocker.agent];

        try {
          if (blocker.agent === 'EQUIPMENT') {
            const retried = await runEquipmentAgent(ctx, brief, summary, { attempt: 2, criticFlag: flag });
            // A new package invalidates the pricing built on the old one.
            await save(projectId, {
              stage: AnalysisStage.VENDOR_BUDGET,
              equipment: retried as unknown as Prisma.InputJsonValue,
              retriedAgents,
            });
            return { done: false, stage: AnalysisStage.VENDOR_BUDGET, pct: STAGE_PROGRESS.VENDOR_BUDGET.pct };
          }

          if (blocker.agent === 'DOP_MATCH') {
            const retried = await runDopAgent(ctx, brief, summary, { attempt: 2, criticFlag: flag });
            await save(projectId, {
              stage: AnalysisStage.CRITIC,
              dops: retried as unknown as Prisma.InputJsonValue,
              retriedAgents,
            });
            return { done: false, stage: AnalysisStage.CRITIC, pct: STAGE_PROGRESS.CRITIC.pct };
          }

          const retried = await runVendorBudgetAgent(ctx, brief, summary, equipment, {
            attempt: 2,
            criticFlag: flag,
          });
          await save(projectId, {
            stage: AnalysisStage.CRITIC,
            vendorBudget: retried as unknown as Prisma.InputJsonValue,
            retriedAgents,
          });
          return { done: false, stage: AnalysisStage.CRITIC, pct: STAGE_PROGRESS.CRITIC.pct };
        } catch (error) {
          // A failed retry must not sink a sheet that is otherwise complete.
          report({
            type: 'log',
            message: `Retry of ${blocker.agent} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          });
          await save(projectId, { stage: AnalysisStage.ASSEMBLE, retriedAgents });
          return { done: false, stage: AnalysisStage.ASSEMBLE, pct: STAGE_PROGRESS.ASSEMBLE.pct };
        }
      }

      // ---- 7. executive summary + persistence
      case AnalysisStage.ASSEMBLE: {
        report({ type: 'stage', stage: 'saving', pct: progress.pct });
        const parts = readParts(state);
        const critic = readJson<CriticResult>(state.critic) ?? {
          passed: true,
          issues: [],
          summary: '',
        };

        const handle = await startRun({
          ctx,
          agent: AgentName.ORCHESTRATOR,
          model: MODELS.reasoning,
          systemPrompt: ORCHESTRATOR_SYSTEM,
          input: { stage: 'assemble', locale: brief.locale },
        });
        const runStartedAt = Date.now();

        const rationaleText = await writeExecutiveSummary(brief, {
          summary: parts.summary,
          equipment: parts.equipment,
          dops: parts.dops,
          vendorBudget: parts.vendorBudget,
          criticIssues: critic.issues,
        });

        const sheet: ProductionSheet = {
          sceneSummary: parts.summary,
          scenes: await loadSceneRequirements(projectId),
          equipment: parts.equipment,
          dops: parts.dops,
          vendorBudget: parts.vendorBudget,
          critic,
          rationaleText,
          modelVersions: ctx.modelVersions,
        };

        await persistSheet(projectId, sheet, brief.locale);
        await save(projectId, { stage: AnalysisStage.DONE });

        await finishRun(handle, {
          status: AgentRunStatus.OK,
          output: {
            sceneCount: sheet.sceneSummary.sceneCount,
            packageSize: sheet.equipment.package.length,
            dopMatches: sheet.dops.matches.length,
            vendors: sheet.vendorBudget.vendors.length,
            criticPassed: critic.passed,
            mid: sheet.vendorBudget.mid,
          },
          startedAt: runStartedAt,
        });

        report({ type: 'stage', stage: 'done', pct: 100 });
        report({ type: 'done', projectId });
        return { done: true, stage: AnalysisStage.DONE, pct: 100 };
      }

      default:
        throw new Error(`UNHANDLED_STAGE_${state.stage}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.$transaction([
      prisma.analysisState.update({
        where: { projectId },
        data: { stage: AnalysisStage.FAILED, errorText: message.slice(0, 2000) },
      }),
      prisma.project.update({ where: { id: projectId }, data: { status: ProjectStatus.FAILED } }),
    ]);
    report({ type: 'error', message });
    return { done: true, stage: AnalysisStage.FAILED, pct: 100, failed: true };
  }
}

/**
 * Runs a whole analysis in one call. Used by the smoke script and by any
 * deployment with a long enough function duration; the UI uses the stepwise
 * path above.
 */
export async function runProductionAnalysis(
  projectId: string,
  report: ProgressReporter,
  locale = 'ar',
): Promise<ProductionSheet> {
  await beginAnalysis(projectId, locale);

  for (;;) {
    const outcome = await advanceAnalysis(projectId, report, { budgetMs: 10 * 60_000 });
    if (outcome.failed) {
      const state = await prisma.analysisState.findUnique({ where: { projectId } });
      throw new Error(state?.errorText ?? 'ANALYSIS_FAILED');
    }
    if (outcome.done) break;
  }

  const recommendation = await prisma.projectRecommendation.findUnique({ where: { projectId } });
  if (!recommendation) throw new Error('SHEET_NOT_PERSISTED');

  return {
    sceneSummary: recommendation.sceneSummary as unknown as SceneSummary,
    scenes: await loadSceneRequirements(projectId),
    equipment: {
      package: recommendation.equipmentPackage as unknown as EquipmentResult['package'],
      rationale: recommendation.equipmentRationale,
      droppedHallucinatedIds: [],
    },
    dops: {
      matches: recommendation.matchedDops as unknown as DopResult['matches'],
      queryText: '',
      searchedCount: 0,
      note: null,
    },
    vendorBudget: {
      vendors: recommendation.matchedVendors as unknown as VendorBudgetResult['vendors'],
      budget: recommendation.budgetBreakdown as unknown as VendorBudgetResult['budget'],
      low: recommendation.estimatedBudgetLow,
      mid: recommendation.estimatedBudgetMid,
      high: recommendation.estimatedBudgetHigh,
      notes: [],
      uncoveredEquipment: [],
    },
    critic: {
      passed: recommendation.criticPassed,
      issues: [],
      summary: recommendation.criticNotes.join(' | '),
    },
    rationaleText: recommendation.rationaleText,
    modelVersions: recommendation.modelVersions as Record<string, string>,
  };
}

// ------------------------------------------------------------------ helpers

type StateRow = NonNullable<Awaited<ReturnType<typeof prisma.analysisState.findUnique>>>;

function readJson<T>(value: Prisma.JsonValue | null): T | null {
  return value === null || value === undefined ? null : (value as unknown as T);
}

function readParts(state: StateRow) {
  const summary = readJson<SceneSummary>(state.summary);
  const equipment = readJson<EquipmentResult>(state.equipment);
  const dops = readJson<DopResult>(state.dops);
  const vendorBudget = readJson<VendorBudgetResult>(state.vendorBudget);
  if (!summary || !equipment || !dops || !vendorBudget) throw new Error('INCOMPLETE_ANALYSIS_STATE');
  return { summary, equipment, dops, vendorBudget };
}

async function save(projectId: string, data: Prisma.AnalysisStateUpdateInput) {
  await prisma.analysisState.update({ where: { projectId }, data });
}

async function writeExecutiveSummary(
  brief: ProjectBrief,
  parts: {
    summary: SceneSummary;
    equipment: EquipmentResult;
    dops: DopResult;
    vendorBudget: VendorBudgetResult;
    criticIssues: CriticIssue[];
  },
) {
  try {
    const { text } = await generateText({
      model: model('reasoning'),
      system: `${ORCHESTRATOR_SYSTEM}\n\n${languageDirective(brief.locale)}`,
      temperature: 0.4,
      prompt: [
        `Project "${brief.name}" — ${brief.type}, ${brief.budgetTier} tier, ${brief.city}.`,
        brief.visualStyleTags.length ? `Requested look: ${brief.visualStyleTags.join(', ')}.` : '',
        `${parts.summary.sceneCount} scenes, ${parts.summary.shootDays} shoot day(s), ${parts.summary.nightScenePct}% night/dawn, ${parts.summary.exteriorScenePct}% exterior, ${parts.summary.highComplexityPct}% high lighting complexity.`,
        `Package: ${parts.equipment.package.map((i) => `${i.brand} ${i.model}`).join(', ')}.`,
        `Department rationale: ${parts.equipment.rationale}`,
        parts.dops.matches.length
          ? `Top cinematographer matches: ${parts.dops.matches.map((d) => `${d.name} (${d.score})`).join(', ')}.`
          : 'No cinematographer matches were available.',
        `Vendors: ${parts.vendorBudget.vendors.map((v) => v.companyName).join(', ') || 'none found'}.`,
        `Estimate ${parts.vendorBudget.low}–${parts.vendorBudget.high} ${parts.vendorBudget.budget.currency} (mid ${parts.vendorBudget.mid}).`,
        parts.criticIssues.length
          ? `Reviewer notes: ${parts.criticIssues.map((i) => `${i.severity}: ${i.problem}`).join(' | ')}`
          : 'The reviewer found no issues.',
        '',
        `Write the summary in ${languageName(brief.locale)}.`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
    return text.trim();
  } catch {
    // The sheet is already complete without prose; never fail the run over it.
    return '';
  }
}

async function persistSheet(projectId: string, sheet: ProductionSheet, locale: string) {
  const data = {
    recommendedEquipmentIds: sheet.equipment.package.map((i) => i.equipmentId),
    equipmentPackage: sheet.equipment.package as unknown as Prisma.InputJsonValue,
    equipmentRationale: sheet.equipment.rationale,
    matchedDops: sheet.dops.matches as unknown as Prisma.InputJsonValue,
    matchedVendors: sheet.vendorBudget.vendors as unknown as Prisma.InputJsonValue,
    estimatedBudgetLow: sheet.vendorBudget.low,
    estimatedBudgetMid: sheet.vendorBudget.mid,
    estimatedBudgetHigh: sheet.vendorBudget.high,
    currency: sheet.vendorBudget.budget.currency,
    budgetBreakdown: {
      ...sheet.vendorBudget.budget,
      notes: sheet.vendorBudget.notes,
      uncoveredEquipment: sheet.vendorBudget.uncoveredEquipment,
      dopQuery: sheet.dops.queryText,
    } as unknown as Prisma.InputJsonValue,
    rationaleText: sheet.rationaleText,
    locale,
    criticNotes: sheet.critic.issues.map(
      (i) => `[${i.severity}] ${i.agent}: ${i.problem} → ${i.suggestion}`,
    ),
    criticPassed: sheet.critic.passed,
    sceneSummary: sheet.sceneSummary as unknown as Prisma.InputJsonValue,
    modelVersions: sheet.modelVersions as unknown as Prisma.InputJsonValue,
    generatedAt: new Date(),
  };

  await prisma.$transaction([
    prisma.projectRecommendation.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    }),
    prisma.project.update({ where: { id: projectId }, data: { status: ProjectStatus.READY } }),
  ]);
}

async function loadBrief(projectId: string, locale: string): Promise<ProjectBrief> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { owner: { select: { locale: true } }, script: { select: { id: true } } },
  });
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  if (!project.script) throw new Error('NO_SCRIPT_UPLOADED');

  return {
    projectId: project.id,
    name: project.name,
    type: project.type,
    budgetTier: project.budgetTier,
    visualStyleTags: project.visualStyleTags,
    city: project.city,
    shootStartDate: project.shootStartDate,
    shootEndDate: project.shootEndDate,
    synopsis: project.synopsis,
    // The language the run was started in wins over the account default, so the
    // sheet comes back in whatever language the producer is using right now.
    locale: locale || project.owner.locale,
  };
}
