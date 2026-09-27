import 'server-only';
import { openai } from '@ai-sdk/openai';
import { tool } from 'ai';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { convert, type Fx } from '@/lib/currency';
import { repricePackage } from '@/lib/package-edit';
import { equipmentName } from '@/lib/equipment-name';
import { languageDirective } from '@/agents/language';
import type { Advice, BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';

/**
 * The project assistant: a conversation about one production.
 *
 * Two kinds of knowledge, kept apart. The platform's own data — the priced
 * package, the rental companies that stock it, real day rates — comes through
 * tools and is quoted as fact; package edits go through the same
 * repricePackage the package editor uses. Everything beyond it — directors,
 * cast and cinematographers anywhere in the market, equipment not in the
 * catalog, market prices, permits — comes from web search and the model's own
 * knowledge, and is presented as a suggestion to verify.
 */

export const CHAT_MAX_HISTORY = 40;

export function chatSystemPrompt(args: {
  locale: string;
  project: {
    name: string;
    type: string;
    city: string;
    visualStyleTags: string[];
    synopsis: string | null;
    budgetMin: number | null;
    budgetMax: number | null;
    shootStartDate: Date | null;
    shootEndDate: Date | null;
  };
  scriptFile: string | null;
  sceneCount: number;
  hasSheet: boolean;
  currency: string;
}) {
  const { project } = args;
  const dates =
    project.shootStartDate && project.shootEndDate
      ? `${project.shootStartDate.toISOString().slice(0, 10)} to ${project.shootEndDate.toISOString().slice(0, 10)}`
      : 'not set';
  const budget =
    project.budgetMin !== null && project.budgetMax !== null
      ? `${project.budgetMin.toLocaleString('en')}–${project.budgetMax.toLocaleString('en')} SAR`
      : 'not given yet';

  return `You are the production assistant inside Sinemai AI, talking with the person behind one production. They may be a seasoned producer or making their first film: speak plainly, explain any film term you use, and never assume they know the jargon.

You help them plan the whole production — what the script needs, how long the shoot takes, what it costs, which scenes are dangerous or expensive and how to handle them, and who could make it: directors, cinematographers, cast, crew.

PROJECT
- Name: ${project.name}
- Type: ${project.type}; budget: ${budget}; city: ${project.city}
- Visual style: ${project.visualStyleTags.join(', ') || 'none chosen'}
- Shoot dates: ${dates}
- Synopsis: ${project.synopsis ?? 'none'}
- Script: ${args.scriptFile ? `${args.scriptFile}, ${args.sceneCount} scenes` : 'not uploaded yet'}
- Sheet: ${args.hasSheet ? 'generated' : 'not generated yet'}
- Money is shown to this user in ${args.currency}.

TWO KINDS OF KNOWLEDGE — keep them apart
- The platform's own data (getSheet, getScenes, searchCatalog, findAlternatives): the priced package, rental companies that actually stock the gear, real day rates. Quote these as facts.
- Everything else — directors, actors, cinematographers anywhere in the market, equipment not in the catalog, market prices, permits, safety rules — comes from web_search and your own knowledge. Use web_search for anything current or specific (who is active, recent credits, today's prices). Present it as a suggestion to verify, and never invent a person or a credit.

HOW TO WORK
- Always give more than one option: several directors, several actors per role, several ways to handle a scene, several ways to save — with what each option trades off.
- When something important is unclear (budget, where it will be shown, dates, cast, locations), ask first — one or two plain questions at a time — then answer with the best fit.
- To change the package, call updatePackage with ids from getSheet, searchCatalog or findAlternatives, then report the new totals.
- If there is no script yet, tell them to upload it above. If there is a script but no sheet, the analysis is running or needs "Run breakdown".
- Be clear and structured: short headings and lists, numbers from the tools.

THE OPENING BRIEFING
When asked for the briefing (the first message once the sheet is ready), call getSheet (it includes the advisor's research) and getScenes, then findAlternatives for the two or three most expensive items, and write, with headings:
1. What this script needs — the essentials by department, each with why the scenes need it.
2. How long the shoot takes — days and a realistic range.
3. The costly and risky scenes — each with two or three ways to handle it for less or more safely.
4. Who could make it — several directors, cinematographers and actors for the lead roles, each with what they are known for.
5. Alternatives and where to save — options with the amount each saves, and the new estimate.
6. The budget — how the estimate compares with theirs.
End with one or two questions that would sharpen the plan, and offer to apply any of the savings.

${languageDirective(args.locale)}`;
}

export function makeChatTools(args: { projectId: string; locale: string; fx: Fx }) {
  const { projectId, locale, fx } = args;
  const money = (value: number | null | undefined) =>
    typeof value === 'number' ? `${convert(value, fx).toLocaleString('en')} ${fx.code}` : null;

  const getSheet = tool({
    description:
      'Read the current sheet: equipment package (with equipment ids), budget low/mid/high and its breakdown, rental companies, matched cinematographers and reviewer notes.',
    inputSchema: z.object({}),
    execute: async () => {
      const rec = await prisma.projectRecommendation.findUnique({ where: { projectId } });
      if (!rec) return { status: 'No sheet yet. The producer needs to upload a script and run the breakdown.' };

      const pkg = (rec.equipmentPackage as unknown as PackageItem[]) ?? [];
      const names = await prisma.equipment.findMany({
        where: { id: { in: pkg.map((item) => item.equipmentId) } },
        select: { id: true, brand: true, model: true, nameAr: true },
      });
      const nameOf = new Map(names.map((row) => [row.id, equipmentName(row, locale)]));
      const budget = rec.budgetBreakdown as unknown as BudgetBreakdown | null;
      const summary = rec.sceneSummary as unknown as SceneSummary | null;
      const advice = (rec.advice as unknown as Advice | null) ?? null;

      return {
        package: pkg.map((item) => ({
          equipmentId: item.equipmentId,
          name: nameOf.get(item.equipmentId) ?? `${item.brand} ${item.model}`,
          category: item.categorySlug,
          quantity: item.quantity,
          rentalDays: item.rentalDays,
          reason: item.reason,
        })),
        budget: {
          low: money(rec.estimatedBudgetLow),
          mid: money(rec.estimatedBudgetMid),
          high: money(rec.estimatedBudgetHigh),
          equipmentRental: money(budget?.equipmentRental),
          crew: money(budget?.crewTotal),
          contingency: money(budget?.contingency),
          contingencyPct: budget?.contingencyPct,
          shootDays: budget?.shootDays,
          crewLines: (budget?.crewBreakdown ?? []).map((line) => ({
            role: locale === 'ar' ? line.labelAr : line.labelEn,
            headcount: line.headcount,
            days: line.days,
            total: money(line.total),
          })),
        },
        rentalCompanies: ((rec.matchedVendors as unknown as VendorMatch[]) ?? []).map((vendor) => ({
          name: vendor.companyName,
          city: vendor.city,
          coveragePct: vendor.coveragePct,
          subtotal: money(vendor.subtotal),
        })),
        cinematographers: ((rec.matchedDops as unknown as DopMatch[]) ?? []).map((dop) => ({
          name: dop.name,
          matchPct: Math.round(dop.score * 100),
          dayRate: money(dop.dayRate),
          reason: dop.reason,
        })),
        sceneSummary: summary
          ? {
              scenes: summary.sceneCount,
              shootDays: summary.shootDays,
              nightPct: summary.nightScenePct,
              exteriorPct: summary.exteriorScenePct,
              highLightingPct: summary.highComplexityPct,
            }
          : null,
        reviewerNotes: rec.criticNotes.map((note) => note.replace(/^\[\w+\]\s*[A-Z_]+:\s*/, '')),
        // The advisor's research: suggestions, not platform facts.
        advisor: advice
          ? {
              ...advice,
              equipmentIdeas: advice.equipmentIdeas.map((idea) => ({ ...idea, approxDayRate: money(idea.approxDayRateSar) })),
              savings: advice.savings.map((saving) => ({ ...saving, estimatedSaving: money(saving.estimatedSavingSar) })),
              note: 'Suggestions from research — people and market prices to verify, not platform data.',
            }
          : null,
        editedByHand: Boolean(rec.editedAt),
      };
    },
  });

  const getScenes = tool({
    description: 'Read the script breakdown scene by scene: heading, interior/exterior, time of day, lighting, camera movement, hours and special requirements.',
    inputSchema: z.object({}),
    execute: async () => {
      const scenes = await prisma.scene.findMany({
        where: { script: { projectId } },
        orderBy: { order: 'asc' },
        take: 200,
        select: {
          order: true,
          heading: true,
          intExt: true,
          timeOfDay: true,
          lightingComplexity: true,
          lightingNotes: true,
          cameraMovement: true,
          estimatedHours: true,
          specialRequirements: true,
        },
      });
      return scenes.length ? { scenes } : { status: 'No script uploaded yet.' };
    },
  });

  const searchCatalog = tool({
    description:
      'Search the equipment catalog by words (brand, model or type) and/or category. Returns equipment ids to use with updatePackage, and the lowest rental day rate.',
    inputSchema: z.object({
      query: z.string().max(80).optional().describe('e.g. "ALEXA", "gimbal", "LED panel"'),
      category: z
        .enum(['camera-body', 'lens', 'lighting', 'grip', 'support', 'sound', 'power'])
        .optional(),
    }),
    execute: async ({ query, category }) => {
      const words = (query ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4);
      const where: Prisma.EquipmentWhereInput = {
        active: true,
        ...(category ? { category: { slug: category } } : {}),
        ...(words.length
          ? {
              AND: words.map((word) => ({
                OR: [
                  { brand: { contains: word, mode: 'insensitive' } },
                  { model: { contains: word, mode: 'insensitive' } },
                  { nameAr: { contains: word, mode: 'insensitive' } },
                  { summaryEn: { contains: word, mode: 'insensitive' } },
                ],
              })),
            }
          : {}),
      };
      const items = await prisma.equipment.findMany({
        where,
        take: 20,
        orderBy: [{ category: { sortOrder: 'asc' } }, { brand: 'asc' }],
        include: {
          category: { select: { slug: true } },
          inventory: { where: { active: true, vendor: { status: 'APPROVED' } }, select: { dailyRate: true } },
        },
      });
      return {
        results: items.map((item) => ({
          equipmentId: item.id,
          name: equipmentName(item, locale),
          category: item.category.slug,
          about: (locale === 'ar' && item.summaryAr ? item.summaryAr : item.summaryEn).slice(0, 200),
          dayRate: item.inventory.length
            ? money(Math.min(...item.inventory.map((row) => row.dailyRate)))
            : item.indicativeDayRate
              ? `~${money(item.indicativeDayRate)} (indicative, no company stocks it)`
              : null,
        })),
      };
    },
  });

  const findAlternatives = tool({
    description:
      'For one equipment id, list other catalog items in the same category with their day rates and what they are good for — cheaper options first — so you can suggest swaps.',
    inputSchema: z.object({ equipmentId: z.string().min(1) }),
    execute: async ({ equipmentId }) => {
      const item = await prisma.equipment.findUnique({
        where: { id: equipmentId },
        select: { id: true, brand: true, model: true, nameAr: true, categoryId: true, indicativeDayRate: true },
      });
      if (!item) return { error: 'Unknown equipment id.' };
      const rateOf = (row: { indicativeDayRate: number | null; inventory: Array<{ dailyRate: number }> }) =>
        row.inventory.length ? Math.min(...row.inventory.map((line) => line.dailyRate)) : row.indicativeDayRate;
      const liveStock = { where: { active: true, vendor: { status: 'APPROVED' as const } }, select: { dailyRate: true } };

      const [current, others] = await Promise.all([
        prisma.equipment.findUnique({ where: { id: item.id }, include: { inventory: liveStock } }),
        prisma.equipment.findMany({
          where: { categoryId: item.categoryId, active: true, id: { not: item.id } },
          include: { inventory: liveStock },
          take: 30,
        }),
      ]);
      const currentRate = current ? rateOf(current) : null;
      return {
        current: { name: equipmentName(item, locale), dayRate: money(currentRate) },
        alternatives: others
          .map((row) => ({ row, rate: rateOf(row) }))
          .sort((a, b) => (a.rate ?? Infinity) - (b.rate ?? Infinity))
          .slice(0, 6)
          .map(({ row, rate }) => ({
            equipmentId: row.id,
            name: equipmentName(row, locale),
            dayRate: money(rate),
            stockedByCompanies: row.inventory.length,
            savesPerDay: currentRate !== null && rate !== null ? money(currentRate - rate) : null,
            about: (locale === 'ar' && row.summaryAr ? row.summaryAr : row.summaryEn).slice(0, 200),
          })),
      };
    },
  });

  const updatePackage = tool({
    description:
      'Change the equipment package and re-price the sheet. Each change sets the quantity and/or rental days of an item (adding it if it is not in the package) or removes it. Returns the new budget.',
    inputSchema: z.object({
      changes: z
        .array(
          z.object({
            equipmentId: z.string().min(1),
            remove: z.boolean().optional(),
            quantity: z.number().int().min(1).max(20).optional(),
            rentalDays: z.number().int().min(1).max(180).optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async ({ changes }) => {
      const rec = await prisma.projectRecommendation.findUnique({
        where: { projectId },
        select: { equipmentPackage: true, estimatedBudgetMid: true, budgetBreakdown: true },
      });
      if (!rec) return { error: 'There is no sheet to change yet.' };

      const current = (rec.equipmentPackage as unknown as PackageItem[]) ?? [];
      const shootDays = (rec.budgetBreakdown as unknown as BudgetBreakdown | null)?.shootDays ?? 1;
      const next = new Map(
        current.map((item) => [
          item.equipmentId,
          { equipmentId: item.equipmentId, quantity: item.quantity, rentalDays: item.rentalDays },
        ]),
      );
      for (const change of changes) {
        if (change.remove) {
          next.delete(change.equipmentId);
          continue;
        }
        const existing = next.get(change.equipmentId);
        next.set(change.equipmentId, {
          equipmentId: change.equipmentId,
          quantity: change.quantity ?? existing?.quantity ?? 1,
          rentalDays: change.rentalDays ?? existing?.rentalDays ?? shootDays,
        });
      }

      try {
        const priced = await repricePackage(projectId, [...next.values()], 'Added in the chat.');
        return {
          ok: true,
          items: priced.items,
          budget: { low: money(priced.low), mid: money(priced.mid), high: money(priced.high) },
          previousMid: money(rec.estimatedBudgetMid),
        };
      } catch (error) {
        const code = error instanceof Error ? error.message : 'FAILED';
        return { error: code === 'PACKAGE_EMPTY' ? 'A package needs at least one item.' : code };
      }
    },
  });

  // Everything outside the platform's own data: people, market prices, permits.
  const web_search = openai.tools.webSearch({
    searchContextSize: 'medium',
    userLocation: { type: 'approximate', country: 'SA' },
  });

  return { getSheet, getScenes, searchCatalog, findAlternatives, updatePackage, web_search };
}
