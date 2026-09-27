import { openai } from '@ai-sdk/openai';
import { generateObject, generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { AgentName } from '@prisma/client';
import { model, MODELS, withAgentRun, type RunContext } from './runtime';
import { withLanguage } from './language';
import { describeBudget, describeClarifications } from './clarifications';
import { describeSceneFlags } from './scene-flags';
import { describeSummary } from './equipment-agent';
import type {
  Advice,
  AdviceNotes,
  EquipmentResult,
  ProjectBrief,
  SceneRequirement,
  SceneSummary,
  VendorBudgetResult,
} from './types';

/**
 * The advisor: looks past the platform's own data.
 *
 * The rest of the graph prices the shoot from the catalog, the rental
 * companies the admin keeps and market estimates. The advisor answers what
 * those cannot: which directors and actors suit
 * this production (anyone in the market, not only profiles on the platform),
 * what else is worth renting, how long the shoot will really take, which scenes
 * are dangerous or expensive and how to handle each more cheaply. It searches
 * the web so names and prices come from somewhere, and it always gives several
 * options. Everything it says is presented as a suggestion to verify.
 *
 * Two stages, because a web search and a structured write-up do not both fit
 * inside one short request: research (notes + sources), then structure.
 */

const ADVISOR_SYSTEM = `You are a senior producer and casting consultant for the Saudi and wider Gulf/Arab film and advertising market. You advise on one production, using the script breakdown, the priced package, what the producer told you, and web research.

Always give several options, never a single answer: 3–5 directors, 2–3 actors for each lead role, 2–3 ways to handle each costly scene, several savings. Prefer people who are active in the region and whose recent work fits this production's type, style, budget and where it will be shown. Never invent a person or a credit: name only people you found in research or are confident exist, and say what they are known for. If you are unsure whether someone is available or affordable, say so.`;

const RESEARCH_TASK = `Research on the web, briefly and to the point:
1. Directors suited to this production (type, style, budget, audience) — active in Saudi Arabia / the Gulf / the Arab world where possible, with a recent credit each.
2. Actors for the lead roles the scenes suggest, matching the cast preference if given, with a known credit each.
3. Current rental or market day rates in Saudi Arabia for any equipment worth adding that is not in the package (e.g. specialist rigs, underwater housings, vehicle mounts), and permit or safety requirements for risky scenes (drones, roads, water, firearms, crowds).
Write compact notes with names, credits and figures.`;

const adviceSchema = z.object({
  shootDuration: z.object({
    days: z.number().int().min(1).max(365),
    rangeLow: z.number().int().min(1).max(365),
    rangeHigh: z.number().int().min(1).max(400),
    rationale: z.string().max(400),
  }),
  budgetFit: z.object({
    verdict: z.enum(['within', 'over', 'under', 'unknown']),
    note: z.string().max(400),
  }),
  costlyScenes: z
    .array(
      z.object({
        scenes: z.string().max(80).describe('Scene numbers, e.g. "2, 5".'),
        whyCostly: z.string().max(300),
        risk: z.enum(['safety', 'cost', 'both']),
        options: z.array(z.string().max(240)).min(2).max(4),
      }),
    )
    .max(8),
  directors: z.array(z.object({ name: z.string().max(80), knownFor: z.string().max(160), why: z.string().max(240) })).max(5),
  cast: z
    .array(
      z.object({
        role: z.string().max(80),
        suggestions: z.array(z.object({ name: z.string().max(80), why: z.string().max(200) })).min(1).max(3),
      }),
    )
    .max(5),
  equipmentIdeas: z
    .array(z.object({ item: z.string().max(120), why: z.string().max(240), approxDayRateSar: z.number().nullable() }))
    .max(6),
  savings: z.array(z.object({ idea: z.string().max(300), estimatedSavingSar: z.number().nullable() })).min(2).max(6),
});

function describeScenes(scenes: SceneRequirement[]) {
  return scenes
    .slice(0, 120)
    .map(
      (scene) =>
        `Sc. ${scene.order}: ${scene.heading} | ${scene.environment}, ${scene.time_of_day} | lighting ${scene.lighting_complexity} | ${scene.camera_movement} | ${scene.estimated_shoot_hours}h${
          scene.special_requirements.length ? ` | special: ${scene.special_requirements.join(', ')}` : ''
        }`,
    )
    .join('\n');
}

function describeProduction(
  brief: ProjectBrief,
  summary: SceneSummary,
  equipment: EquipmentResult,
  vendorBudget: VendorBudgetResult,
) {
  return [
    `Production: "${brief.name}" — ${brief.type}, shooting in ${brief.city}.`,
    brief.visualStyleTags.length ? `Visual style: ${brief.visualStyleTags.join(', ')}.` : '',
    brief.synopsis ? `Synopsis: ${brief.synopsis.slice(0, 1200)}` : '',
    describeBudget(brief),
    describeClarifications(brief.clarifications),
    describeSceneFlags(brief.sceneFlags),
    '',
    'Breakdown:',
    describeSummary(summary),
    '',
    `Priced package (catalog gear, plus market gear at estimated rates): ${equipment.package.map((item) => `${item.brand} ${item.model} ×${item.quantity} for ${item.rentalDays}d`).join('; ')}.`,
    `Estimate: ${vendorBudget.low}–${vendorBudget.high} SAR (mid ${vendorBudget.mid}); equipment ${vendorBudget.budget.equipmentRental}, crew ${vendorBudget.budget.crewTotal}; ${vendorBudget.budget.shootDays} shoot day(s) at the platform's day length.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Stage 1: web research. Returns notes and the sources behind them. */
export async function runAdvisorResearch(
  ctx: RunContext,
  brief: ProjectBrief,
  parts: { summary: SceneSummary; equipment: EquipmentResult; vendorBudget: VendorBudgetResult },
): Promise<AdviceNotes> {
  return withAgentRun(
    {
      ctx,
      agent: AgentName.ORCHESTRATOR,
      model: MODELS.reasoning,
      systemPrompt: ADVISOR_SYSTEM,
      input: { stage: 'advisor-research', locale: brief.locale },
    },
    async () => {
      ctx.report({ type: 'stage', stage: 'researching', pct: 88 });
      const result = await generateText({
        model: model('reasoning'),
        system: ADVISOR_SYSTEM,
        tools: {
          web_search: openai.tools.webSearch({
            searchContextSize: 'medium',
            userLocation: { type: 'approximate', country: 'SA' },
          }),
        },
        stopWhen: stepCountIs(4),
        temperature: 0.3,
        prompt: [describeProduction(brief, parts.summary, parts.equipment, parts.vendorBudget), '', RESEARCH_TASK].join('\n'),
      });

      const seen = new Set<string>();
      const sources = result.sources
        .flatMap((source) => (source.sourceType === 'url' ? [{ title: source.title ?? source.url, url: source.url }] : []))
        .filter((source) => (seen.has(source.url) ? false : (seen.add(source.url), true)))
        .slice(0, 12);

      return { output: { text: result.text.slice(0, 12_000), sources } };
    },
  );
}

/** Stage 2: the structured advice, grounded in the research notes and the scenes. */
export async function runAdvisor(
  ctx: RunContext,
  brief: ProjectBrief,
  parts: { summary: SceneSummary; equipment: EquipmentResult; vendorBudget: VendorBudgetResult },
  scenes: SceneRequirement[],
  notes: AdviceNotes | null,
): Promise<Advice> {
  const system = withLanguage(ADVISOR_SYSTEM, brief.locale);
  return withAgentRun(
    {
      ctx,
      agent: AgentName.ORCHESTRATOR,
      model: MODELS.reasoning,
      systemPrompt: system,
      input: { stage: 'advisor', locale: brief.locale, researched: Boolean(notes?.text) },
    },
    async () => {
      ctx.report({ type: 'stage', stage: 'advising', pct: 91 });
      const { object } = await generateObject({
        model: model('reasoning'),
        schema: adviceSchema,
        system,
        temperature: 0.3,
        prompt: [
          describeProduction(brief, parts.summary, parts.equipment, parts.vendorBudget),
          '',
          'Scenes:',
          describeScenes(scenes),
          '',
          notes?.text ? `Research notes:\n${notes.text}` : 'No web research was available; rely on what you know and say where you are unsure.',
          '',
          `Write the advice. Costly scenes: start from the flagged scenes above (every high-severity flag must appear), then add any others. Shoot duration: start from the platform's ${parts.summary.shootDays} day(s) and adjust for company moves, night work and risky scenes; give a realistic range. Budget fit: compare the mid estimate with the producer's budget. Costly scenes: the scenes that drive cost or carry safety risk, each with 2–4 ways to handle it for less. People: several options each, names exactly as found.`,
        ].join('\n'),
      });
      return { output: { ...object, sources: notes?.sources ?? [] } };
    },
  );
}
