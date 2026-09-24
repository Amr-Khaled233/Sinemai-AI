import { generateObject } from 'ai';
import { z } from 'zod';
import { AgentName } from '@prisma/client';
import { getBudgetTierConfig } from '@/lib/settings';
import { model, MODELS, withAgentRun, type RunContext } from './runtime';
import { describeSummary } from './equipment-agent';
import { withLanguage } from './language';
import type {
  CriticIssue,
  CriticResult,
  DopResult,
  EquipmentResult,
  ProjectBrief,
  SceneSummary,
  VendorBudgetResult,
} from './types';

export const CRITIC_SYSTEM = `You are the quality gate on an automated production breakdown. You have no tools: you reason only over the assembled sheet you are given.

Check for:
1. Budget tier violation — the estimate sits outside the declared tier's currency window.
2. Weak DOP matches — similarity scores too low to be meaningful, or explanations that reference styles the DOP never claimed.
3. Scene/equipment contradiction — e.g. a night-heavy breakdown with no high-output or low-light-capable gear, heavy gimbal work with no stabiliser, drone scenes with no aerial platform, exteriors with no grip/diffusion.
4. Fabrication — any equipment, vendor, cinematographer, spec or price that does not trace back to a tool result. Every id you are given came from the database; a *missing* category is a real issue, an unfamiliar model name is not.
5. Internal inconsistency — rental days exceeding the shoot length, crew roles missing for the work described, coverage claims that contradict the vendor list.

Severity: "blocker" only when the sheet would mislead a producer making a spending decision. "warning" when it needs a caveat. "info" for notes worth surfacing.
Set passed=false only when at least one blocker exists. Assign each issue to the agent that must fix it: SCRIPT_ANALYST, EQUIPMENT, DOP_MATCH or VENDOR_BUDGET. Be specific and terse; the suggestion is fed back to that agent verbatim.`;

const criticSchema = z.object({
  passed: z.boolean(),
  summary: z.string().max(600),
  issues: z
    .array(
      z.object({
        agent: z.enum(['SCRIPT_ANALYST', 'EQUIPMENT', 'DOP_MATCH', 'VENDOR_BUDGET']),
        severity: z.enum(['info', 'warning', 'blocker']),
        problem: z.string().max(300),
        suggestion: z.string().max(300),
      }),
    )
    .max(8),
});

export async function runCriticAgent(
  ctx: RunContext,
  brief: ProjectBrief,
  parts: {
    summary: SceneSummary;
    equipment: EquipmentResult;
    dops: DopResult;
    vendorBudget: VendorBudgetResult;
  },
  options: { attempt?: number } = {},
): Promise<CriticResult> {
  const tierConfig = await getBudgetTierConfig(brief.budgetTier);

  // The review is wrapped rather than allowed to throw: a reviewer that cannot
  // run must not block a sheet that is otherwise complete, so the failure is
  // recorded on the run row and the sheet ships with a visible caveat instead.
  try {
    return await withAgentRun(
      {
        ctx,
        agent: AgentName.CRITIC,
        attempt: options.attempt ?? 1,
        model: MODELS.reasoning,
        systemPrompt: withLanguage(CRITIC_SYSTEM, brief.locale),
        input: { budgetTier: brief.budgetTier, tierWindow: [tierConfig.minTotal, tierConfig.maxTotal] },
      },
      async () => {
      ctx.report({ type: 'stage', stage: 'reviewing', pct: 80 });

      const { object } = await generateObject({
        model: model('reasoning'),
        schema: criticSchema,
        system: withLanguage(CRITIC_SYSTEM, brief.locale),
        temperature: 0.1,
        prompt: [
          `PROJECT: "${brief.name}" — ${brief.type}, declared budget tier ${brief.budgetTier} (${tierConfig.minTotal}–${tierConfig.maxTotal} ${tierConfig.currency}), ${brief.city}.`,
          brief.visualStyleTags.length ? `Requested visual style: ${brief.visualStyleTags.join(', ')}.` : '',
          '',
          'SCENE BREAKDOWN:',
          describeSummary(parts.summary),
          '',
          'RECOMMENDED PACKAGE:',
          ...parts.equipment.package.map(
            (i) =>
              `- ${i.categorySlug}: ${i.brand} ${i.model} ×${i.quantity} for ${i.rentalDays} day(s) — ${i.reason}`,
          ),
          `Rationale: ${parts.equipment.rationale}`,
          parts.equipment.droppedHallucinatedIds.length
            ? `NOTE: ${parts.equipment.droppedHallucinatedIds.length} selected id(s) were not in the catalog shortlist and were dropped before pricing.`
            : '',
          '',
          'DOP MATCHES:',
          parts.dops.matches.length
            ? parts.dops.matches
                .map(
                  (d) =>
                    `- ${d.name} (score ${d.score}) tags: ${d.styleTags.join(', ') || '—'} — ${d.reason}`,
                )
                .join('\n')
            : '- none returned',
          parts.dops.note ? `Matching note: ${parts.dops.note}` : '',
          '',
          'VENDORS & BUDGET:',
          ...parts.vendorBudget.vendors.map(
            (v) =>
              `- ${v.companyName} (${v.city}): ${v.itemsCovered} item(s), ${v.coveragePct}% coverage, subtotal ${v.subtotal} ${parts.vendorBudget.budget.currency}`,
          ),
          parts.vendorBudget.uncoveredEquipment.length
            ? `Unstocked items: ${parts.vendorBudget.uncoveredEquipment
                .map((u) => `${u.brand} ${u.model}${u.fallbackDayRate ? '' : ' (no rate at all)'}`)
                .join(', ')}`
            : '',
          `Equipment rental: ${parts.vendorBudget.budget.equipmentRental}. Crew: ${parts.vendorBudget.budget.crewTotal} across ${parts.vendorBudget.budget.crewBreakdown.length} role(s) over ${parts.vendorBudget.budget.shootDays} day(s).`,
          `Estimate — low ${parts.vendorBudget.low}, mid ${parts.vendorBudget.mid}, high ${parts.vendorBudget.high} ${parts.vendorBudget.budget.currency}.`,
          parts.vendorBudget.notes.length ? `Sourcing notes: ${parts.vendorBudget.notes.join(' | ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      });

      // Deterministic checks the model should not be trusted to do by eye.
      const mechanical = mechanicalChecks(brief, parts, tierConfig);
      const issues: CriticIssue[] = [...mechanical, ...(object.issues as CriticIssue[])];
      const passed = object.passed && !issues.some((i) => i.severity === 'blocker');

      const result: CriticResult = {
        passed,
        issues: dedupeIssues(issues),
        summary: object.summary,
      };

        return {
          output: result,
          criticFlag: passed ? undefined : issues.map((i) => `${i.agent}: ${i.problem}`).join(' | '),
        };
      },
    );
  } catch {
    return {
      passed: true,
      issues: [
        {
          agent: 'EQUIPMENT',
          severity: 'info',
          problem: 'Automated review did not complete, so this sheet was not quality-checked.',
          suggestion: 'Re-run the analysis to get a reviewed sheet.',
        },
      ],
      summary: 'Review step unavailable.',
    };
  }
}

function mechanicalChecks(
  brief: ProjectBrief,
  parts: {
    summary: SceneSummary;
    equipment: EquipmentResult;
    dops: DopResult;
    vendorBudget: VendorBudgetResult;
  },
  tier: { minTotal: number; maxTotal: number; currency: string },
): CriticIssue[] {
  const issues: CriticIssue[] = [];
  const { summary, equipment, vendorBudget } = parts;

  if (vendorBudget.mid > tier.maxTotal) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'blocker',
      problem: `Mid estimate ${vendorBudget.mid} ${tier.currency} exceeds the ${brief.budgetTier} tier ceiling of ${tier.maxTotal}.`,
      suggestion: `Rebuild the package inside the ${brief.budgetTier} tier: drop or downgrade the most expensive line items and do not set includeAdjacentTiers.`,
    });
  }

  const categories = new Set(equipment.package.map((i) => i.categorySlug));
  if (!categories.has('camera-body')) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'blocker',
      problem: 'The package contains no camera body.',
      suggestion: 'Query the catalog for category camera-body and include one body sized to the budget tier.',
    });
  }
  if (!categories.has('lighting') && summary.nightScenePct > 20) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'blocker',
      problem: `${summary.nightScenePct}% of scenes are night or dawn/dusk but no lighting package was recommended.`,
      suggestion: 'Query the lighting category and add a key/fill package suited to low-light interiors and exteriors.',
    });
  }
  if (!categories.has('lens')) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'warning',
      problem: 'No lens set was recommended.',
      suggestion: 'Add a lens set matching the requested visual style.',
    });
  }
  if (summary.movementMix.STEADICAM_GIMBAL + summary.movementMix.CRANE_DOLLY > 0 && !categories.has('support') && !categories.has('grip')) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'warning',
      problem: 'The breakdown has stabilised or dolly moves but the package has no support/grip items.',
      suggestion: 'Add a gimbal, steadicam or dolly from the support/grip categories.',
    });
  }

  const overlongLines = equipment.package.filter((i) => i.rentalDays > summary.shootDays);
  if (overlongLines.length) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'warning',
      problem: `${overlongLines.length} line item(s) are booked for more days than the ${summary.shootDays}-day shoot.`,
      suggestion: 'Cap rental days at the shoot length unless prep days are justified in the reason.',
    });
  }

  if (equipment.droppedHallucinatedIds.length) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'warning',
      problem: `${equipment.droppedHallucinatedIds.length} recommended id(s) did not exist in the catalog and were removed.`,
      suggestion: 'Select only ids present in the retrieved shortlist.',
    });
  }

  if (vendorBudget.budget.crewBreakdown.length === 0) {
    issues.push({
      agent: 'VENDOR_BUDGET',
      severity: 'blocker',
      problem: 'The budget contains no crew cost.',
      suggestion: 'Call getCrewDayRates and include the roles this production needs on the floor.',
    });
  }

  return issues;
}

function dedupeIssues(issues: CriticIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.agent}:${issue.problem.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
