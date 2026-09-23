import { generateText } from 'ai';
import { AgentName, AgentRunStatus, ProjectStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createRunContext, finishRun, model, MODELS, startRun } from './runtime';
import { runScriptAnalyst } from './script-analyst';
import { runEquipmentAgent } from './equipment-agent';
import { runDopAgent } from './dop-agent';
import { runVendorBudgetAgent } from './vendor-budget-agent';
import { runCriticAgent } from './critic-agent';
import type {
  CriticIssue,
  DopResult,
  EquipmentResult,
  ProductionSheet,
  ProgressReporter,
  ProjectBrief,
  VendorBudgetResult,
} from './types';

export const ORCHESTRATOR_SYSTEM = `You are the supervising producer of an automated breakdown. You have no database access: you delegate to specialist agents and then write the short executive summary that opens the Production & Equipment Sheet.

Write 3–5 sentences for the director/producer who will act on this sheet. Lead with what the script demands, then why this package and these people answer it, then the money and the single biggest caveat. Cite concrete numbers from the breakdown. No bullet points, no marketing language, no invented facts.`;

/**
 * Agent 1 — Orchestrator.
 *
 * Owns execution order and the final assembly. Equipment and DOP matching run
 * concurrently once scene data exists; vendor pricing waits for the package.
 * The Critic reviews the assembled sheet, and any agent it blocks gets exactly
 * one retry with the specific complaint fed back in.
 */
export async function runProductionAnalysis(
  projectId: string,
  report: ProgressReporter,
): Promise<ProductionSheet> {
  const ctx = createRunContext(projectId, report);
  const startedAt = Date.now();
  const brief = await loadBrief(projectId);

  const handle = await startRun({
    ctx,
    agent: AgentName.ORCHESTRATOR,
    model: MODELS.reasoning,
    systemPrompt: ORCHESTRATOR_SYSTEM,
    input: { brief: { ...brief, shootStartDate: null, shootEndDate: null } },
  });

  await prisma.project.update({ where: { id: projectId }, data: { status: ProjectStatus.ANALYZING } });
  report({ type: 'stage', stage: 'queued', pct: 4, detail: brief.name });

  try {
    // ---- 1. scene data (everything downstream depends on it)
    const analyst = await runScriptAnalyst(ctx, brief);

    // ---- 2. equipment + DOP matching, concurrently
    report({ type: 'log', message: 'Matching equipment and cinematographers' });
    const [equipmentSettled, dopsSettled] = await Promise.allSettled([
      runEquipmentAgent(ctx, brief, analyst.summary),
      runDopAgent(ctx, brief, analyst.summary),
    ]);

    if (equipmentSettled.status === 'rejected') throw equipmentSettled.reason;
    let equipment: EquipmentResult = equipmentSettled.value;

    // A DOP failure degrades the sheet; it does not sink it.
    let dops: DopResult =
      dopsSettled.status === 'fulfilled'
        ? dopsSettled.value
        : {
            matches: [],
            queryText: '',
            searchedCount: 0,
            note: 'Cinematographer matching failed for this run; the rest of the sheet is unaffected.',
          };

    // ---- 3. vendors + budget (needs the package)
    let vendorBudget: VendorBudgetResult = await runVendorBudgetAgent(ctx, brief, analyst.summary, equipment);

    // ---- 4. review, then at most one targeted retry per agent
    let critic = await runCriticAgent(ctx, brief, {
      summary: analyst.summary,
      equipment,
      dops,
      vendorBudget,
    });

    const blockers = critic.issues.filter((i) => i.severity === 'blocker');
    if (blockers.length) {
      report({ type: 'stage', stage: 'retrying', pct: 84, detail: `${blockers.length}` });

      const retried = new Set<string>();
      let packageChanged = false;

      for (const blocker of blockers) {
        if (retried.has(blocker.agent)) continue; // cap: one retry per agent
        retried.add(blocker.agent);
        const flag = `${blocker.problem} ${blocker.suggestion}`;

        try {
          if (blocker.agent === 'EQUIPMENT') {
            equipment = await runEquipmentAgent(ctx, brief, analyst.summary, { attempt: 2, criticFlag: flag });
            packageChanged = true;
          } else if (blocker.agent === 'DOP_MATCH') {
            dops = await runDopAgent(ctx, brief, analyst.summary, { attempt: 2, criticFlag: flag });
          } else if (blocker.agent === 'VENDOR_BUDGET') {
            vendorBudget = await runVendorBudgetAgent(ctx, brief, analyst.summary, equipment, {
              attempt: 2,
              criticFlag: flag,
            });
          }
          // SCRIPT_ANALYST is not retried here: re-running the breakdown would
          // invalidate the equipment and pricing built on top of it. Its blockers
          // are surfaced to the producer instead.
        } catch (error) {
          report({
            type: 'log',
            message: `Retry of ${blocker.agent} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          });
        }
      }

      if (packageChanged) {
        vendorBudget = await runVendorBudgetAgent(ctx, brief, analyst.summary, equipment, { attempt: 2 });
      }

      critic = await runCriticAgent(
        ctx,
        brief,
        { summary: analyst.summary, equipment, dops, vendorBudget },
        { attempt: 2 },
      );
    }

    // ---- 5. executive summary + persistence
    report({ type: 'stage', stage: 'saving', pct: 92 });
    const rationaleText = await writeExecutiveSummary(brief, {
      summary: analyst.summary,
      equipment,
      dops,
      vendorBudget,
      criticIssues: critic.issues,
    });

    const sheet: ProductionSheet = {
      sceneSummary: analyst.summary,
      scenes: analyst.scenes,
      equipment,
      dops,
      vendorBudget,
      critic,
      rationaleText,
      modelVersions: ctx.modelVersions,
    };

    await persistSheet(projectId, sheet);

    await finishRun(handle, {
      status: AgentRunStatus.OK,
      output: {
        sceneCount: analyst.summary.sceneCount,
        packageSize: equipment.package.length,
        dopMatches: dops.matches.length,
        vendors: vendorBudget.vendors.length,
        criticPassed: critic.passed,
        mid: vendorBudget.mid,
      },
      startedAt,
    });

    report({ type: 'stage', stage: 'done', pct: 100 });
    report({ type: 'done', projectId });
    return sheet;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.project.update({ where: { id: projectId }, data: { status: ProjectStatus.FAILED } });
    await finishRun(handle, { status: AgentRunStatus.FAILED, errorText: message, startedAt });
    report({ type: 'error', message });
    throw error;
  }
}

async function writeExecutiveSummary(
  brief: ProjectBrief,
  parts: {
    summary: ProductionSheet['sceneSummary'];
    equipment: EquipmentResult;
    dops: DopResult;
    vendorBudget: VendorBudgetResult;
    criticIssues: CriticIssue[];
  },
) {
  try {
    const { text } = await generateText({
      model: model('reasoning'),
      system: ORCHESTRATOR_SYSTEM,
      temperature: 0.4,
      prompt: [
        `Project "${brief.name}" — ${brief.type}, ${brief.budgetTier} tier, ${brief.city}.`,
        brief.visualStyleTags.length ? `Requested look: ${brief.visualStyleTags.join(', ')}.` : '',
        `${parts.summary.sceneCount} scenes, ${parts.summary.shootDays} shoot day(s), ${parts.summary.nightScenePct}% night/dawn, ${parts.summary.exteriorScenePct}% exterior, ${parts.summary.highComplexityPct}% high lighting complexity.`,
        `Package: ${parts.equipment.package.map((i) => `${i.brand} ${i.model}`).join(', ')}.`,
        `Department rationale: ${parts.equipment.rationale}`,
        parts.dops.matches.length
          ? `Top cinematographer matches: ${parts.dops.matches
              .map((d) => `${d.name} (${d.score})`)
              .join(', ')}.`
          : 'No cinematographer matches were available.',
        `Vendors: ${parts.vendorBudget.vendors.map((v) => v.companyName).join(', ') || 'none found'}.`,
        `Estimate ${parts.vendorBudget.low}–${parts.vendorBudget.high} ${parts.vendorBudget.budget.currency} (mid ${parts.vendorBudget.mid}).`,
        parts.criticIssues.length
          ? `Reviewer notes: ${parts.criticIssues.map((i) => `${i.severity}: ${i.problem}`).join(' | ')}`
          : 'The reviewer found no issues.',
        '',
        `Write the summary in ${brief.locale === 'ar' ? 'Arabic' : 'English'}.`,
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

async function persistSheet(projectId: string, sheet: ProductionSheet) {
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
    criticNotes: sheet.critic.issues.map((i) => `[${i.severity}] ${i.agent}: ${i.problem} → ${i.suggestion}`),
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

async function loadBrief(projectId: string): Promise<ProjectBrief> {
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
    locale: project.owner.locale,
  };
}
