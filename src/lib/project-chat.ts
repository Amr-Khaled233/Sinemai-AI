import 'server-only';
import { tool } from 'ai';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { convert, type Fx } from '@/lib/currency';
import { repricePackage } from '@/lib/package-edit';
import { equipmentName } from '@/lib/equipment-name';
import { languageDirective } from '@/agents/language';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';

/**
 * The project assistant: a conversation about one project, with tools that read
 * the real sheet and change the real package.
 *
 * The same rule as the agents holds: facts come from tools, not from the
 * model's memory. It reads the package, prices and scenes through tools, finds
 * equipment through the catalog tool, and edits the package through the same
 * repricePackage the package editor uses — so a change made in chat is priced
 * exactly like one made by hand.
 */

export const CHAT_MAX_HISTORY = 40;

export function chatSystemPrompt(args: {
  locale: string;
  project: {
    name: string;
    type: string;
    budgetTier: string;
    city: string;
    visualStyleTags: string[];
    synopsis: string | null;
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

  return `You are the production assistant inside Sinemai AI, talking with the producer of one project. You help them understand and adjust their Production & Equipment Sheet: the scene breakdown, the equipment package, the rental companies, the cinematographers and the budget.

PROJECT
- Name: ${project.name}
- Type: ${project.type}; budget tier: ${project.budgetTier}; city: ${project.city}
- Visual style: ${project.visualStyleTags.join(', ') || 'none chosen'}
- Shoot dates: ${dates}
- Synopsis: ${project.synopsis ?? 'none'}
- Script: ${args.scriptFile ? `${args.scriptFile}, ${args.sceneCount} scenes` : 'not uploaded yet'}
- Sheet: ${args.hasSheet ? 'generated' : 'not generated yet'}
- Money is shown to this user in ${args.currency}.

HOW TO WORK
- Never state a price, a spec, an equipment name or a scene detail you did not get from a tool in this conversation. Call getSheet, getScenes or searchCatalog first.
- To change the package, call updatePackage with equipment ids from getSheet or searchCatalog. Confirm what you are about to change in one short sentence when the request is ambiguous; when it is clear, just do it and report the new totals.
- If there is no script yet, tell them to upload it with the button above the chat. If there is a script but no sheet, tell them to press "Run breakdown". You cannot upload or run the breakdown yourself.
- Be brief and concrete: a few sentences or a short list. Cite numbers from the tools.

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

  return { getSheet, getScenes, searchCatalog, updatePackage };
}
