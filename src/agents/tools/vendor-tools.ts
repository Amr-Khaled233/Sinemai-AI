import { z } from 'zod';
import { BudgetTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { loggedTool, type AgentRunHandle } from '../runtime';

/**
 * Vendor availability and crew rate tools.
 *
 * Every number in the final budget originates here: vendor day/week rates from
 * VendorInventoryItem, crew day rates from the admin-maintained CrewRate table.
 * The model never estimates a price.
 */

export const vendorInventorySchema = z.object({
  equipmentIds: z.array(z.string()).min(1).max(40).describe('Equipment ids from the recommended package.'),
  startDate: z.string().optional().describe('Shoot start date, ISO yyyy-mm-dd.'),
  endDate: z.string().optional().describe('Shoot end date, ISO yyyy-mm-dd.'),
  city: z.string().optional().describe('Preferred city for pickup.'),
});

export const crewRatesSchema = z.object({
  roles: z
    .array(z.string())
    .optional()
    .describe('Role slugs to price, e.g. ["dop","gaffer","focus-puller"]. Omit for the full standard unit.'),
});

export type VendorInventoryRow = {
  vendorId: string;
  companyName: string;
  city: string;
  verified: boolean;
  contactEmail: string | null;
  phone: string | null;
  items: Array<{
    equipmentId: string;
    brand: string;
    model: string;
    dailyRate: number;
    weeklyRate: number | null;
    monthlyRate: number | null;
    currency: string;
    quantityAvailable: number;
    availableInRange: boolean;
    blockedQuantity: number;
    city: string;
  }>;
};

export type VendorInventoryResult = {
  vendors: VendorInventoryRow[];
  requestedIds: string[];
  unstockedIds: string[];
  /** Indicative market rates for items no approved vendor stocks. */
  fallbackRates: Array<{ equipmentId: string; brand: string; model: string; indicativeDayRate: number | null }>;
};

export async function queryVendorInventory(
  input: z.infer<typeof vendorInventorySchema>,
): Promise<VendorInventoryResult> {
  const start = input.startDate ? new Date(input.startDate) : null;
  const end = input.endDate ? new Date(input.endDate) : null;
  const hasRange = Boolean(start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()));

  const items = await prisma.vendorInventoryItem.findMany({
    where: {
      active: true,
      equipmentId: { in: input.equipmentIds },
      vendor: { status: 'APPROVED' },
    },
    include: {
      equipment: { select: { id: true, brand: true, model: true } },
      vendor: {
        select: {
          id: true,
          verified: true,
          company: { select: { name: true, city: true, phone: true, email: true } },
        },
      },
      blocks: hasRange
        ? {
            where: {
              startDate: { lte: end as Date },
              endDate: { gte: start as Date },
            },
            select: { quantity: true },
          }
        : { where: { id: '' }, select: { quantity: true } },
    },
  });

  const byVendor = new Map<string, VendorInventoryRow>();

  for (const item of items) {
    const blockedQuantity = item.blocks.reduce((sum, b) => sum + b.quantity, 0);
    const row = byVendor.get(item.vendorId) ?? {
      vendorId: item.vendorId,
      companyName: item.vendor.company.name,
      city: item.vendor.company.city,
      verified: item.vendor.verified,
      contactEmail: item.vendor.company.email,
      phone: item.vendor.company.phone,
      items: [],
    };
    row.items.push({
      equipmentId: item.equipmentId,
      brand: item.equipment.brand,
      model: item.equipment.model,
      dailyRate: item.dailyRate,
      weeklyRate: item.weeklyRate,
      monthlyRate: item.monthlyRate,
      currency: item.currency,
      quantityAvailable: item.quantityAvailable,
      availableInRange: item.quantityAvailable - blockedQuantity > 0,
      blockedQuantity,
      city: item.city,
    });
    byVendor.set(item.vendorId, row);
  }

  const stockedIds = new Set(items.map((i) => i.equipmentId));
  const unstockedIds = input.equipmentIds.filter((id) => !stockedIds.has(id));

  const fallbackRates = unstockedIds.length
    ? (
        await prisma.equipment.findMany({
          where: { id: { in: unstockedIds } },
          select: { id: true, brand: true, model: true, indicativeDayRate: true },
        })
      ).map((e) => ({
        equipmentId: e.id,
        brand: e.brand,
        model: e.model,
        indicativeDayRate: e.indicativeDayRate,
      }))
    : [];

  // Preferred city first, then most items covered, then cheapest basket.
  const vendors = [...byVendor.values()].sort((a, b) => {
    const cityScore = (v: VendorInventoryRow) => (input.city && v.city === input.city ? 1 : 0);
    if (cityScore(b) !== cityScore(a)) return cityScore(b) - cityScore(a);
    if (b.items.length !== a.items.length) return b.items.length - a.items.length;
    const basket = (v: VendorInventoryRow) => v.items.reduce((sum, i) => sum + i.dailyRate, 0);
    return basket(a) - basket(b);
  });

  return { vendors, requestedIds: input.equipmentIds, unstockedIds, fallbackRates };
}

export type CrewRateRow = {
  roleSlug: string;
  labelEn: string;
  labelAr: string;
  dayRate: number;
  headcount: number;
  currency: string;
};

export async function getCrewDayRates(
  input: z.infer<typeof crewRatesSchema>,
  context: { budgetTier: BudgetTier },
): Promise<{ tier: BudgetTier; rates: CrewRateRow[] }> {
  const rates = await prisma.crewRate.findMany({
    where: {
      active: true,
      budgetTier: context.budgetTier,
      ...(input.roles?.length ? { roleSlug: { in: input.roles } } : {}),
    },
    orderBy: { dayRate: 'desc' },
  });

  return {
    tier: context.budgetTier,
    rates: rates.map((r) => ({
      roleSlug: r.roleSlug,
      labelEn: r.labelEn,
      labelAr: r.labelAr,
      dayRate: r.dayRate,
      headcount: r.headcount,
      currency: r.currency,
    })),
  };
}

export function makeVendorTools(handle: AgentRunHandle, context: { budgetTier: BudgetTier }) {
  return {
    queryVendorInventory: loggedTool(
      handle,
      'queryVendorInventory',
      {
        description:
          'Find approved rental vendors that stock the recommended equipment, with their day/week rates, quantities and availability across the shoot dates. The only permitted source of rental prices.',
        inputSchema: vendorInventorySchema,
        execute: (input) => queryVendorInventory(input),
      },
    ),

    getCrewDayRates: loggedTool(
      handle,
      'getCrewDayRates',
      {
        description:
          'Admin-configured crew day rates for this budget tier, per role, with assumed headcount. The only permitted source of crew costs.',
        inputSchema: crewRatesSchema,
        execute: (input) => getCrewDayRates(input, context),
      },
    ),
  };
}
