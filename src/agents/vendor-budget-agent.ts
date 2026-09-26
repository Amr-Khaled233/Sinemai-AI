import { generateObject, generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { AgentName } from '@prisma/client';
import { getSettings } from '@/lib/settings';
import { allToolResults, model, MODELS, withAgentRun, type RunContext } from './runtime';
import { makeVendorTools, queryVendorInventory, getCrewDayRates } from './tools/vendor-tools';
import type { CrewRateRow, VendorInventoryResult, VendorInventoryRow } from './tools/vendor-tools';
import { withLanguage } from './language';
import { describeClarifications } from './clarifications';
import type {
  CrewLine,
  EquipmentResult,
  ProjectBrief,
  SceneSummary,
  VendorBudgetResult,
  VendorLine,
  VendorMatch,
} from './types';

export const VENDOR_BUDGET_SYSTEM = `You are a line producer sourcing a rental package in Saudi Arabia.

Workflow:
1. Call queryVendorInventory with every equipment id in the recommended package, plus the shoot dates and the production city.
2. Call getCrewDayRates for the crew this production actually needs on the floor.

Hard rules:
- Never state or estimate a price yourself. Every rate must come from a tool result.
- Never invent a vendor, a company name or an availability status.
- Arithmetic is done for you: your job is sourcing judgement and honest caveats (split rentals across vendors, items nobody stocks, blocked dates, out-of-city pickup).`;

const notesSchema = z.object({
  notes: z.array(z.string().max(220)).max(6),
  crewRoles: z
    .array(z.string())
    .max(14)
    .describe('Role slugs from getCrewDayRates that this production genuinely needs on the floor.'),
});

export async function runVendorBudgetAgent(
  ctx: RunContext,
  brief: ProjectBrief,
  summary: SceneSummary,
  equipment: EquipmentResult,
  options: { attempt?: number; criticFlag?: string } = {},
): Promise<VendorBudgetResult> {
  const settings = await getSettings();

  return withAgentRun(
    {
      ctx,
      agent: AgentName.VENDOR_BUDGET,
      attempt: options.attempt ?? 1,
      model: MODELS.reasoning,
      systemPrompt: withLanguage(VENDOR_BUDGET_SYSTEM, brief.locale),
      input: {
        package: equipment.package,
        shootDays: summary.shootDays,
        criticFlag: options.criticFlag ?? null,
      },
    },
    async (handle) => {
      ctx.report({ type: 'stage', stage: 'pricing', pct: 68 });

      const tools = makeVendorTools(handle, { budgetTier: brief.budgetTier });
      const equipmentIds = equipment.package.map((i) => i.equipmentId);

      await generateText({
        model: model('reasoning'),
        system: withLanguage(VENDOR_BUDGET_SYSTEM, brief.locale),
        tools,
        stopWhen: stepCountIs(4),
        temperature: 0.2,
        prompt: [
          `Production: "${brief.name}" — ${brief.type}, budget tier ${brief.budgetTier}, ${summary.shootDays} shoot day(s) in ${brief.city}.`,
          brief.shootStartDate
            ? `Shoot dates: ${iso(brief.shootStartDate)} to ${iso(brief.shootEndDate ?? brief.shootStartDate)}.`
            : 'Shoot dates are not fixed yet; check general availability.',
          describeClarifications(brief.clarifications),
          '',
          'Recommended package:',
          ...equipment.package.map(
            (i) => `- ${i.equipmentId} | ${i.brand} ${i.model} | ${i.categorySlug} | qty ${i.quantity} | ${i.rentalDays} day(s)`,
          ),
          '',
          options.criticFlag ? `Reviewer flag on the previous pass: ${options.criticFlag}` : '',
          'Source this package and pull the crew rates for this tier.',
        ]
          .filter(Boolean)
          .join('\n'),
      });

      // ---- collect tool facts, with a deterministic fallback so the budget is never model-guessed
      let inventory = mergeInventory(allToolResults<VendorInventoryResult>(handle, 'queryVendorInventory'));
      if (!inventory || inventory.vendors.length === 0) {
        inventory = await queryVendorInventory({
          equipmentIds,
          startDate: brief.shootStartDate ? iso(brief.shootStartDate) : undefined,
          endDate: brief.shootEndDate ? iso(brief.shootEndDate) : undefined,
          city: brief.city,
        });
      }

      let crewRates = allToolResults<{ rates?: CrewRateRow[] }>(handle, 'getCrewDayRates')
        .flatMap((r) => r.rates ?? [])
        .filter((r, index, all) => all.findIndex((x) => x.roleSlug === r.roleSlug) === index);
      if (crewRates.length === 0) {
        crewRates = (await getCrewDayRates({}, { budgetTier: brief.budgetTier })).rates;
      }

      // ---- sourcing judgement + caveats from the model, priced by code
      const { object } = await generateObject({
        model: model('cheap'),
        schema: notesSchema,
        system: withLanguage(VENDOR_BUDGET_SYSTEM, brief.locale),
        temperature: 0.3,
        prompt: [
          `Production: ${brief.type}, ${summary.shootDays} shoot day(s) in ${brief.city}, budget tier ${brief.budgetTier}.`,
          describeClarifications(brief.clarifications),
          `Night/dawn scenes: ${summary.nightScenePct}%. Exteriors: ${summary.exteriorScenePct}%. Movement: gimbal ${summary.movementMix.STEADICAM_GIMBAL}, crane/dolly ${summary.movementMix.CRANE_DOLLY}, drone ${summary.movementMix.DRONE}.`,
          '',
          'Vendor coverage returned by the tool:',
          ...inventory.vendors.map(
            (v) =>
              `- ${v.companyName} (${v.city})${v.verified ? ' [verified]' : ''}: ${v.items.length} of ${
                equipmentIds.length
              } items; blocked in range: ${v.items.filter((i) => !i.availableInRange).length}`,
          ),
          inventory.unstockedIds.length
            ? `Items no approved vendor stocks: ${inventory.fallbackRates
                .map((f) => `${f.brand} ${f.model}`)
                .join(', ')}`
            : 'Every package item is stocked by at least one approved vendor.',
          '',
          'Crew roles available at this tier:',
          ...crewRates.map((r) => `- ${r.roleSlug} (${r.labelEn}): ${r.dayRate} ${r.currency}/day × ${r.headcount}`),
          '',
          'Return the crew roles this production needs and up to six sourcing caveats. No prices in the notes.',
        ]
          .filter(Boolean)
          .join('\n'),
      });

      // ---- pricing: pure arithmetic over tool-sourced rates
      const result = priceProject({
        equipment,
        inventory,
        crewRates,
        selectedRoles: new Set(object.crewRoles),
        shootDays: summary.shootDays,
        city: brief.city,
        settings,
        notes: object.notes,
      });

      return { output: result };
    },
  );
}

// ------------------------------------------------------------------ pricing

/**
 * Turns a package plus vendor and crew rates into a costed sheet.
 *
 * The single source of truth for money. The agent calls it after sourcing, and
 * so does a producer editing the package by hand — if the two computed totals
 * differently, an edited sheet would silently disagree with the one the agent
 * produced.
 */
export function priceProject(args: {
  equipment: EquipmentResult;
  inventory: VendorInventoryResult;
  crewRates: CrewRateRow[];
  selectedRoles: Set<string>;
  shootDays: number;
  city: string;
  settings: { weeklyRentalDiscountPct: number; contingencyPct: number; currency: string };
  notes?: string[];
}): VendorBudgetResult {
  const { equipment, inventory, crewRates, selectedRoles, shootDays, city, settings } = args;

  const allocation = allocatePackage(equipment, inventory, {
    city,
    weeklyDiscountPct: settings.weeklyRentalDiscountPct,
  });

  const crewBreakdown = buildCrewLines(crewRates, selectedRoles, shootDays);
  const crewTotal = crewBreakdown.reduce((sum, line) => sum + line.total, 0);

  const contingencyPct = settings.contingencyPct;
  const low = allocation.equipmentLow + crewTotal;
  // Mid carries half the contingency, high carries all of it on the worst
  // sourcing, so the spread reflects real vendor prices rather than a guess.
  const mid = Math.round(low + low * (contingencyPct / 200));
  const highBase = allocation.equipmentHigh + crewTotal;
  const high = Math.round(highBase + highBase * (contingencyPct / 100));

  const notes = [...(args.notes ?? [])];
  if (inventory.unstockedIds.length) {
    notes.push(
      `${inventory.unstockedIds.length} item(s) are not stocked by any approved vendor yet and are priced from indicative market rates.`,
    );
  }
  if (allocation.vendors.length > 1) {
    notes.push(`Package splits across ${allocation.vendors.length} vendors for best coverage and price.`);
  }

  return {
    vendors: allocation.vendors,
    budget: {
      shootDays,
      equipmentRental: allocation.equipmentLow,
      equipmentUncovered: allocation.uncoveredFallbackTotal,
      crewTotal,
      crewBreakdown,
      contingencyPct,
      contingency: high - highBase,
      currency: settings.currency,
    },
    low,
    mid,
    high,
    notes,
    uncoveredEquipment: allocation.uncovered,
  };
}

function mergeInventory(results: VendorInventoryResult[]): VendorInventoryResult | null {
  const usable = results.filter((r) => Array.isArray(r?.vendors));
  if (usable.length === 0) return null;
  const vendors = new Map<string, VendorInventoryRow>();
  const requested = new Set<string>();
  const unstocked = new Set<string>();
  const fallback = new Map<string, VendorInventoryResult['fallbackRates'][number]>();

  for (const result of usable) {
    for (const vendor of result.vendors) {
      const existing = vendors.get(vendor.vendorId);
      if (!existing) {
        vendors.set(vendor.vendorId, { ...vendor, items: [...vendor.items] });
        continue;
      }
      for (const item of vendor.items) {
        if (!existing.items.some((i) => i.equipmentId === item.equipmentId)) existing.items.push(item);
      }
    }
    result.requestedIds?.forEach((id) => requested.add(id));
    result.unstockedIds?.forEach((id) => unstocked.add(id));
    result.fallbackRates?.forEach((f) => fallback.set(f.equipmentId, f));
  }

  // An id stocked by any vendor in any call is not unstocked.
  const stocked = new Set([...vendors.values()].flatMap((v) => v.items.map((i) => i.equipmentId)));
  for (const id of stocked) unstocked.delete(id);

  return {
    vendors: [...vendors.values()],
    requestedIds: [...requested],
    unstockedIds: [...unstocked],
    fallbackRates: [...fallback.values()].filter((f) => unstocked.has(f.equipmentId)),
  };
}

/**
 * Effective rental cost for one line, honouring weekly rates on long bookings.
 *
 * Exported for tests: this is the arithmetic a producer will hold us to, so it
 * is verified directly rather than only through a full agent run.
 */
export function lineCost(
  dailyRate: number,
  weeklyRate: number | null,
  days: number,
  quantity: number,
  weeklyDiscountPct: number,
) {
  if (days < 7) return dailyRate * days * quantity;
  const weeks = Math.floor(days / 7);
  const remainder = days % 7;
  const weekRate = weeklyRate ?? Math.round(dailyRate * 7 * (1 - weeklyDiscountPct / 100));
  return (weeks * weekRate + remainder * dailyRate) * quantity;
}

export function allocatePackage(
  equipment: EquipmentResult,
  inventory: VendorInventoryResult,
  opts: { city: string; weeklyDiscountPct: number },
) {
  type Offer = { vendor: VendorInventoryRow; item: VendorInventoryRow['items'][number]; cost: number };

  const byVendor = new Map<string, VendorMatch>();
  const uncovered: VendorBudgetResult['uncoveredEquipment'] = [];
  let equipmentLow = 0;
  let equipmentHigh = 0;
  let uncoveredFallbackTotal = 0;

  for (const packageItem of equipment.package) {
    const offers: Offer[] = [];
    for (const vendor of inventory.vendors) {
      for (const item of vendor.items) {
        if (item.equipmentId !== packageItem.equipmentId) continue;
        offers.push({
          vendor,
          item,
          cost: lineCost(
            item.dailyRate,
            item.weeklyRate,
            packageItem.rentalDays,
            packageItem.quantity,
            opts.weeklyDiscountPct,
          ),
        });
      }
    }

    if (offers.length === 0) {
      const fallback = inventory.fallbackRates.find((f) => f.equipmentId === packageItem.equipmentId);
      const rate = fallback?.indicativeDayRate ?? null;
      uncovered.push({
        equipmentId: packageItem.equipmentId,
        brand: packageItem.brand,
        model: packageItem.model,
        fallbackDayRate: rate,
      });
      if (rate) {
        const cost = lineCost(rate, null, packageItem.rentalDays, packageItem.quantity, opts.weeklyDiscountPct);
        equipmentLow += cost;
        equipmentHigh += cost;
        uncoveredFallbackTotal += cost;
      }
      continue;
    }

    // Cheapest available offer wins; same-city and in-range availability break ties.
    const rank = (offer: Offer) =>
      offer.cost +
      (offer.item.availableInRange ? 0 : offer.cost * 0.35) +
      (offer.vendor.city === opts.city ? 0 : offer.cost * 0.05);
    const best = [...offers].sort((a, b) => rank(a) - rank(b))[0];
    const worst = [...offers].sort((a, b) => b.cost - a.cost)[0];

    equipmentLow += best.cost;
    equipmentHigh += worst.cost;

    const match =
      byVendor.get(best.vendor.vendorId) ??
      ({
        vendorId: best.vendor.vendorId,
        companyName: best.vendor.companyName,
        city: best.vendor.city,
        verified: best.vendor.verified,
        coveragePct: 0,
        itemsCovered: 0,
        subtotal: 0,
        contactEmail: best.vendor.contactEmail,
        phone: best.vendor.phone,
        items: [] as VendorLine[],
      } satisfies VendorMatch);

    match.items.push({
      equipmentId: packageItem.equipmentId,
      brand: packageItem.brand,
      model: packageItem.model,
      quantity: packageItem.quantity,
      rentalDays: packageItem.rentalDays,
      dailyRate: best.item.dailyRate,
      weeklyRate: best.item.weeklyRate,
      lineTotal: best.cost,
      available: best.item.availableInRange,
    });
    match.subtotal += best.cost;
    match.itemsCovered = match.items.length;
    match.coveragePct = Math.round((match.items.length / equipment.package.length) * 100);
    byVendor.set(best.vendor.vendorId, match);
  }

  return {
    vendors: [...byVendor.values()].sort((a, b) => b.itemsCovered - a.itemsCovered || a.subtotal - b.subtotal),
    equipmentLow: Math.round(equipmentLow),
    equipmentHigh: Math.round(equipmentHigh),
    uncovered,
    uncoveredFallbackTotal: Math.round(uncoveredFallbackTotal),
  };
}

/** Crew lines for the chosen roles; falls back to the full unit when none match. */
export function buildCrewLines(rates: CrewRateRow[], selected: Set<string>, days: number): CrewLine[] {
  const chosen = rates.filter((r) => selected.size === 0 || selected.has(r.roleSlug));
  const pool = chosen.length ? chosen : rates;
  return pool.map((rate) => ({
    roleSlug: rate.roleSlug,
    labelEn: rate.labelEn,
    labelAr: rate.labelAr,
    headcount: rate.headcount,
    dayRate: rate.dayRate,
    days,
    total: rate.dayRate * rate.headcount * days,
  }));
}

function iso(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}
