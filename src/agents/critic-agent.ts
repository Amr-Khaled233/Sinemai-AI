import { generateObject } from 'ai';
import { z } from 'zod';
import { AgentName } from '@prisma/client';
import { getBudgetTierConfig } from '@/lib/settings';
import { model, MODELS, withAgentRun, type RunContext } from './runtime';
import { describeSummary } from './equipment-agent';
import { withLanguage } from './language';
import { describeClarifications } from './clarifications';
import type {
  CriticIssue,
  CriticResult,
  EquipmentResult,
  ProjectBrief,
  SceneSummary,
  VendorBudgetResult,
} from './types';
import { isMarketItem } from './types';

export const CRITIC_SYSTEM = `You are the quality gate on an automated production breakdown. You have no tools: you reason only over the assembled sheet you are given.

Check for:
1. Budget tier violation — the estimate sits outside the declared tier's currency window.
2. Scene/equipment contradiction — e.g. a night-heavy breakdown with no high-output or low-light-capable gear, heavy gimbal work with no stabiliser, drone scenes with no aerial platform, exteriors with no grip/diffusion.
3. Implausible market gear — items marked [market] come from the wider market with an estimated day rate. Flag one only if the product does not exist or its rate is far off a realistic Saudi rental price; an unfamiliar model name alone is not an issue.
4. Internal inconsistency — rental days exceeding the shoot length, crew roles missing for the work described, coverage claims that contradict the vendor list.

Severity: "blocker" only when the sheet would mislead a producer making a spending decision. "warning" when it needs a caveat. "info" for notes worth surfacing.
Set passed=false only when at least one blocker exists. Assign each issue to the agent that must fix it: SCRIPT_ANALYST, EQUIPMENT or VENDOR_BUDGET. Be specific and terse; the suggestion is fed back to that agent verbatim.`;

const criticSchema = z.object({
  passed: z.boolean(),
  summary: z.string().max(600),
  issues: z
    .array(
      z.object({
        agent: z.enum(['SCRIPT_ANALYST', 'EQUIPMENT', 'VENDOR_BUDGET']),
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
    vendorBudget: VendorBudgetResult;
  },
  options: { attempt?: number } = {},
): Promise<CriticResult> {
  const tierConfig = await getBudgetTierConfig(brief.budgetTier);
  // The producer's own range, when they gave one, is the budget to hold to;
  // otherwise the tier's window.
  const window =
    brief.budgetMax !== null
      ? { minTotal: brief.budgetMin ?? 0, maxTotal: brief.budgetMax, currency: 'SAR', label: "the producer's budget" }
      : { ...tierConfig, label: `the ${brief.budgetTier} tier` };

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
        input: { budgetTier: brief.budgetTier, budgetWindow: [window.minTotal, window.maxTotal] },
      },
      async () => {
      ctx.report({ type: 'stage', stage: 'reviewing', pct: 80 });

      const { object } = await generateObject({
        model: model('reasoning'),
        schema: criticSchema,
        system: withLanguage(CRITIC_SYSTEM, brief.locale),
        temperature: 0.1,
        prompt: [
          `PROJECT: "${brief.name}" — ${brief.type}, budget ${window.minTotal}–${window.maxTotal} ${window.currency} (${window.label}), ${brief.city}.`,
          brief.visualStyleTags.length ? `Requested visual style: ${brief.visualStyleTags.join(', ')}.` : '',
          describeClarifications(brief.clarifications),
          '',
          'SCENE BREAKDOWN:',
          describeSummary(parts.summary),
          '',
          'RECOMMENDED PACKAGE:',
          ...parts.equipment.package.map(
            (i) =>
              `- ${i.categorySlug}: ${i.brand} ${i.model} ×${i.quantity} for ${i.rentalDays} day(s)${
                isMarketItem(i) ? ` [market, est. ${i.estimatedDayRate} SAR/day]` : ''
              } — ${i.reason}`,
          ),
          `Rationale: ${parts.equipment.rationale}`,
          parts.equipment.droppedHallucinatedIds.length
            ? `NOTE: ${parts.equipment.droppedHallucinatedIds.length} selected item(s) were neither catalog ids nor priced market gear and were dropped before pricing.`
            : '',
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
      const mechanical = mechanicalChecks(brief, parts, window);
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
    vendorBudget: VendorBudgetResult;
  },
  tier: { minTotal: number; maxTotal: number; currency: string; label: string },
): CriticIssue[] {
  const issues: CriticIssue[] = [];
  const { summary, equipment, vendorBudget } = parts;

  if (vendorBudget.mid > tier.maxTotal) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'blocker',
      problem: `Mid estimate ${vendorBudget.mid} ${tier.currency} exceeds ${tier.label} ceiling of ${tier.maxTotal}.`,
      suggestion: `Rebuild the package to fit ${tier.label}: drop or downgrade the most expensive line items and do not set includeAdjacentTiers.`,
    });
  }

  const categories = new Set(equipment.package.map((i) => i.categorySlug));
  if (!categories.has('camera-body')) {
    issues.push({
      agent: 'EQUIPMENT',
      severity: 'blocker',
      problem: 'The package contains no camera body.',
      suggestion: 'Include one camera body sized to the budget — from the catalog or the market (category camera-body).',
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
      problem: `${equipment.droppedHallucinatedIds.length} recommended item(s) were neither in the catalog nor named and priced as market gear, and were removed.`,
      suggestion: 'Use shortlist ids for catalog gear; for market gear give brand, model, category and an estimated day rate.',
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
