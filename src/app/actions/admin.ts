'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import {
  ApprovalStatus,
  BudgetTier,
  CameraMovement,
  Complexity,
  DayNightSuitability,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { saveSettings, type PlatformSettings } from '@/lib/settings';
import { dopProfileSchema, rentalCompanySchema } from '@/lib/validation';
import { buildDopEmbeddingText, embedText, writeDopEmbedding } from '@/lib/embeddings';
import { slugify } from '@/lib/utils';
import { reportError } from '@/lib/observability';
import { BASE_CURRENCY, isCurrencyCode, type CurrencyConfig } from '@/lib/currency';
import { saveCurrencyConfig } from '@/lib/currency-server';
import { checkOverride, flattenMessages, type Messages } from '@/lib/site-copy';
import { SITE_COPY_TAG, writeCopyOverride } from '@/lib/site-copy-server';
import {
  addBlockFor,
  deleteInventoryFor,
  removeBlockFor,
  saveInventoryFor,
  toggleInventoryFor,
} from '@/lib/inventory';
import { REVALIDATE, requireAdmin, revalidate, runAction } from './shared';

// ---------------------------------------------------------------- rental companies

/**
 * Rental companies are records the admin keeps — they have no accounts. A
 * company that is switched off is kept with its stock but is never matched or
 * priced from.
 */
export async function saveRentalCompany(formData: FormData) {
  return runAction('saveRentalCompany', async () => {
    await requireAdmin();
    const parsed = rentalCompanySchema.safeParse({
      id: formData.get('id') || undefined,
      name: formData.get('name'),
      city: formData.get('city'),
      phone: formData.get('phone') ?? '',
      email: formData.get('email') ?? '',
      website: formData.get('website') ?? '',
      crNumber: formData.get('crNumber') ?? '',
    });
    if (!parsed.success) throw new Error('INVALID_INPUT');
    const { id, ...fields } = parsed.data;
    const company = {
      name: fields.name,
      city: fields.city,
      phone: fields.phone || null,
      email: fields.email || null,
      website: fields.website || null,
      crNumber: fields.crNumber || null,
    };

    if (id) {
      const vendor = await prisma.vendor.findUnique({ where: { id }, select: { companyId: true } });
      if (!vendor) throw new Error('NOT_FOUND');
      await prisma.company.update({ where: { id: vendor.companyId }, data: company });
    } else {
      const created = await prisma.company.create({ data: { ...company, verified: true }, select: { id: true } });
      await prisma.vendor.create({
        data: { companyId: created.id, status: ApprovalStatus.APPROVED, verified: true, approvedAt: new Date() },
      });
    }
    revalidate(REVALIDATE.adminVendors, REVALIDATE.adminRentals, REVALIDATE.adminHome);
  });
}

export async function setRentalCompanyActive(vendorId: string, active: boolean) {
  return runAction('setRentalCompanyActive', async () => {
    await requireAdmin();
    await prisma.vendor.update({
      where: { id: vendorId },
      data: { status: active ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED },
    });
    revalidate(REVALIDATE.adminVendors, REVALIDATE.adminRentals, REVALIDATE.adminHome);
  });
}

/** Deletes the company with its whole inventory; sheets already generated keep their copy. */
export async function deleteRentalCompany(vendorId: string) {
  return runAction('deleteRentalCompany', async () => {
    await requireAdmin();
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { companyId: true } });
    if (!vendor) throw new Error('NOT_FOUND');
    // The company row owns the vendor row (cascade), which owns the stock.
    await prisma.company.delete({ where: { id: vendor.companyId } });
    revalidate(REVALIDATE.adminVendors, REVALIDATE.adminRentals, REVALIDATE.adminHome);
  });
}

// ---------------------------------------------------------------- cinematographers

/**
 * Cinematographer profiles, kept by the admin. Saving re-embeds the profile so
 * it can be matched; if the embedding call fails (no key, no credit) the save
 * still succeeds and the nightly job or the re-embed button catches up.
 */
export async function saveCinematographer(formData: FormData) {
  return runAction('saveCinematographer', async () => {
    await requireAdmin();
    const parsed = dopProfileSchema.safeParse({
      displayName: formData.get('displayName'),
      displayNameAr: formData.get('displayNameAr') ?? '',
      bio: formData.get('bio'),
      city: formData.get('city') ?? '',
      dayRate: formData.get('dayRate') || undefined,
      yearsExperience: formData.get('yearsExperience') || undefined,
      portfolioLinks: String(formData.get('portfolioLinks') ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      styleTags: formData.getAll('styleTags').map(String),
    });
    if (!parsed.success) throw new Error('INVALID_INPUT');
    const data = parsed.data;
    const fields = {
      displayName: data.displayName,
      displayNameAr: data.displayNameAr || null,
      bio: data.bio,
      city: data.city || null,
      dayRate: data.dayRate ?? null,
      yearsExperience: data.yearsExperience ?? null,
      portfolioLinks: data.portfolioLinks,
      styleTags: data.styleTags,
    };

    const id = String(formData.get('id') ?? '');
    const select = { id: true, displayName: true, bio: true, styleTags: true, city: true, yearsExperience: true };
    const dop = id
      ? await prisma.dop.update({ where: { id }, data: fields, select })
      : await prisma.dop.create({
          data: { ...fields, status: ApprovalStatus.APPROVED, approvedAt: new Date() },
          select,
        });

    if (process.env.OPENAI_API_KEY) {
      try {
        const text = buildDopEmbeddingText(dop);
        await writeDopEmbedding(dop.id, text, await embedText(text));
      } catch (error) {
        reportError(error, { scope: 'admin:dop-embedding', severity: 'warning', extra: { dopId: dop.id } });
      }
    }
    revalidate(REVALIDATE.adminDops, REVALIDATE.adminHome);
  });
}

export async function setCinematographerActive(dopId: string, active: boolean) {
  return runAction('setCinematographerActive', async () => {
    await requireAdmin();
    await prisma.dop.update({
      where: { id: dopId },
      data: { status: active ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED },
    });
    revalidate(REVALIDATE.adminDops, REVALIDATE.adminHome);
  });
}

export async function deleteCinematographer(dopId: string) {
  return runAction('deleteCinematographer', async () => {
    await requireAdmin();
    await prisma.dop.delete({ where: { id: dopId } });
    revalidate(REVALIDATE.adminDops, REVALIDATE.adminHome);
  });
}

// ---------------------------------------------------------------- catalog CRUD

function parseEnumList<T extends string>(formData: FormData, field: string, allowed: readonly T[]): T[] {
  return formData
    .getAll(field)
    .map(String)
    .filter((value): value is T => (allowed as readonly string[]).includes(value));
}

export async function saveEquipment(formData: FormData) {
  return runAction('saveEquipment', async () => {
    await requireAdmin();

    const id = String(formData.get('id') ?? '');
    const brand = String(formData.get('brand') ?? '').trim();
    const model = String(formData.get('model') ?? '').trim();
    const categoryId = String(formData.get('categoryId') ?? '');
    if (!brand || !model || !categoryId) throw new Error('INVALID_INPUT');

    let specs: unknown = {};
    const specsRaw = String(formData.get('specs') ?? '').trim();
    if (specsRaw) {
      try {
        specs = JSON.parse(specsRaw);
      } catch {
        throw new Error('INVALID_SPECS_JSON');
      }
    }

    const indicativeRaw = String(formData.get('indicativeDayRate') ?? '').trim();

    const data = {
      categoryId,
      brand,
      model,
      nameAr: String(formData.get('nameAr') ?? '') || null,
      specs: specs as object,
      summaryEn: String(formData.get('summaryEn') ?? ''),
      summaryAr: String(formData.get('summaryAr') ?? ''),
      suitableLightingComplexity: parseEnumList(formData, 'lighting', Object.values(Complexity)),
      suitableMovementTypes: parseEnumList(formData, 'movement', Object.values(CameraMovement)),
      budgetTier: parseEnumList(formData, 'tiers', Object.values(BudgetTier)),
      dayNightSuitability:
        (String(formData.get('dayNight') ?? 'BOTH') as DayNightSuitability) || DayNightSuitability.BOTH,
      specialCapabilities: String(formData.get('capabilities') ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
      indicativeDayRate: indicativeRaw ? Number(indicativeRaw) : null,
      isCore: formData.get('isCore') === 'on',
      active: formData.get('active') === 'on',
    };

    if (id) {
      await prisma.equipment.update({ where: { id }, data });
    } else {
      await prisma.equipment.upsert({
        where: { brand_model: { brand, model } },
        create: data,
        update: data,
      });
    }

    revalidate(REVALIDATE.adminEquipment);
  });
}

export async function deleteEquipment(id: string) {
  return runAction('deleteEquipment', async () => {
    await requireAdmin();
    await prisma.equipment.delete({ where: { id } });
    revalidate(REVALIDATE.adminEquipment);
  });
}

// ---------------------------------------------------------------- settings

export async function savePlatformSettings(formData: FormData) {
  return runAction('savePlatformSettings', async () => {
    await requireAdmin();

    const numeric = (field: string) => {
      const raw = String(formData.get(field) ?? '').trim();
      if (raw === '') return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    };

    const patch: Partial<PlatformSettings> = {
      defaultCity: String(formData.get('defaultCity') ?? '') || undefined,
      contingencyPct: numeric('contingencyPct'),
      weeklyRentalDiscountPct: numeric('weeklyRentalDiscountPct'),
      dopMatchMinScore: numeric('dopMatchMinScore'),
      dopMatchCount: numeric('dopMatchCount'),
      shootDayHours: numeric('shootDayHours'),
    };

    await saveSettings(
      Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ) as Partial<PlatformSettings>,
    );

    for (const tier of Object.values(BudgetTier)) {
      const min = numeric(`tier_${tier}_min`);
      const max = numeric(`tier_${tier}_max`);
      if (min === undefined || max === undefined) continue;
      const labels = {
        labelEn: String(formData.get(`tier_${tier}_labelEn`) ?? tier),
        labelAr: String(formData.get(`tier_${tier}_labelAr`) ?? tier),
      };
      await prisma.budgetTierConfig.upsert({
        where: { tier },
        create: { tier, minTotal: min, maxTotal: max, ...labels },
        update: { minTotal: min, maxTotal: max, ...labels },
      });
    }

    revalidate(REVALIDATE.adminSettings);
  });
}

export async function saveCrewRate(formData: FormData) {
  return runAction('saveCrewRate', async () => {
    await requireAdmin();
    const roleSlug = String(formData.get('roleSlug') ?? '');
    const tier = String(formData.get('budgetTier') ?? '') as BudgetTier;
    const dayRate = Number(formData.get('dayRate') ?? 0);
    const headcount = Number(formData.get('headcount') ?? 1);

    if (!roleSlug || !Object.values(BudgetTier).includes(tier)) throw new Error('INVALID_INPUT');
    if (!Number.isFinite(dayRate) || dayRate < 0 || !Number.isFinite(headcount) || headcount < 1) {
      throw new Error('INVALID_INPUT');
    }

    await prisma.crewRate.update({
      where: { roleSlug_budgetTier: { roleSlug, budgetTier: tier } },
      data: { dayRate, headcount },
    });

    revalidate(REVALIDATE.adminSettings);
  });
}

export async function saveStyleTag(formData: FormData) {
  return runAction('saveStyleTag', async () => {
    await requireAdmin();
    const labelEn = String(formData.get('labelEn') ?? '').trim();
    const labelAr = String(formData.get('labelAr') ?? '').trim();
    if (!labelEn || !labelAr) throw new Error('INVALID_INPUT');
    const slug = String(formData.get('slug') ?? '') || slugify(labelEn);

    await prisma.styleTag.upsert({
      where: { slug },
      create: { slug, labelEn, labelAr },
      update: { labelEn, labelAr },
    });

    revalidate(REVALIDATE.adminSettings);
  });
}

export async function toggleStyleTag(slug: string, active: boolean) {
  return runAction('toggleStyleTag', async () => {
    await requireAdmin();
    await prisma.styleTag.update({ where: { slug }, data: { active } });
    revalidate(REVALIDATE.adminSettings);
  });
}

// ---------------------------------------------------------------- currencies

const currencySchema = z.object({
  defaultCode: z.string().length(3),
  rates: z
    .array(
      z.object({
        code: z.string().refine(isCurrencyCode),
        perBase: z.number().positive().max(1_000_000),
        enabled: z.boolean(),
      }),
    )
    .max(30),
});

/**
 * Saves the display currencies. Rates are the admin's own numbers — nothing is
 * fetched — and SAR stays the base every stored amount is in, so it cannot be
 * listed as a rate of itself.
 */
export async function saveCurrencies(input: CurrencyConfig) {
  return runAction('saveCurrencies', async () => {
    await requireAdmin();
    const parsed = currencySchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_INPUT');

    const seen = new Set<string>();
    const rates = parsed.data.rates.filter((rate) => {
      if (rate.code === BASE_CURRENCY || seen.has(rate.code)) return false;
      seen.add(rate.code);
      return true;
    });
    const offered = [BASE_CURRENCY, ...rates.filter((r) => r.enabled).map((r) => r.code)];
    const defaultCode = offered.includes(parsed.data.defaultCode) ? parsed.data.defaultCode : BASE_CURRENCY;

    await saveCurrencyConfig({ defaultCode, rates });
    // Every page that prints money reads these rates.
    revalidatePath('/', 'layout');
  });
}

// ---------------------------------------------------------------- site copy

async function shippedMessages(locale: 'en' | 'ar') {
  return flattenMessages((await import(`../../../messages/${locale}.json`)).default as Messages);
}

/**
 * Saves one message in both languages. A value equal to the shipped text
 * removes the override instead of storing a copy of it, so the file stays the
 * source of truth for anything the admin has not actually changed.
 */
export async function saveSiteCopy(key: string, values: { en: string; ar: string }) {
  return runAction('saveSiteCopy', async () => {
    await requireAdmin();
    for (const locale of ['en', 'ar'] as const) {
      const original = (await shippedMessages(locale))[key];
      if (original === undefined) throw new Error('NOT_FOUND');
      const text = values[locale];
      if (text === original) {
        await writeCopyOverride(locale, key, null);
        continue;
      }
      if (checkOverride(original, text)) throw new Error('INVALID_INPUT');
      await writeCopyOverride(locale, key, text);
    }
    revalidateTag(SITE_COPY_TAG);
    revalidatePath('/', 'layout');
  });
}

/** Puts a message back to the shipped text in both languages. */
export async function resetSiteCopy(key: string) {
  return runAction('resetSiteCopy', async () => {
    await requireAdmin();
    await writeCopyOverride('en', key, null);
    await writeCopyOverride('ar', key, null);
    revalidateTag(SITE_COPY_TAG);
    revalidatePath('/', 'layout');
  });
}

// ---------------------------------------------------------------- rental prices

/**
 * The vendor an admin is editing, resolved once so every write is pinned to
 * it. Callers check requireAdmin() first, in their own body, where the
 * access-control audit can see it.
 */
async function vendorForAdmin(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, company: { select: { city: true } } },
  });
  if (!vendor) throw new Error('NOT_FOUND');
  return { id: vendor.id, city: vendor.company.city };
}

const RENTAL_PAGES = [REVALIDATE.adminRentals, REVALIDATE.adminVendors] as const;

export async function adminSaveInventoryItem(vendorId: string, formData: FormData) {
  return runAction('adminSaveInventoryItem', async () => {
    await requireAdmin();
    await saveInventoryFor(await vendorForAdmin(vendorId), formData);
    revalidate(...RENTAL_PAGES);
  });
}

export async function adminDeleteInventoryItem(vendorId: string, itemId: string) {
  return runAction('adminDeleteInventoryItem', async () => {
    await requireAdmin();
    await deleteInventoryFor((await vendorForAdmin(vendorId)).id, itemId);
    revalidate(...RENTAL_PAGES);
  });
}

export async function adminToggleInventoryActive(vendorId: string, itemId: string, active: boolean) {
  return runAction('adminToggleInventoryActive', async () => {
    await requireAdmin();
    await toggleInventoryFor((await vendorForAdmin(vendorId)).id, itemId, active);
    revalidate(...RENTAL_PAGES);
  });
}

export async function adminAddAvailabilityBlock(vendorId: string, formData: FormData) {
  return runAction('adminAddAvailabilityBlock', async () => {
    await requireAdmin();
    await addBlockFor((await vendorForAdmin(vendorId)).id, formData);
    revalidate(...RENTAL_PAGES);
  });
}

export async function adminRemoveAvailabilityBlock(vendorId: string, blockId: string) {
  return runAction('adminRemoveAvailabilityBlock', async () => {
    await requireAdmin();
    await removeBlockFor((await vendorForAdmin(vendorId)).id, blockId);
    revalidate(...RENTAL_PAGES);
  });
}

// ---------------------------------------------------------------- form bindings
// <form action={...}> requires a void-returning action; these wrap the
// result-returning versions above for server-rendered forms.

export async function savePlatformSettingsForm(formData: FormData): Promise<void> {
  await savePlatformSettings(formData);
}

export async function saveCrewRateForm(formData: FormData): Promise<void> {
  await saveCrewRate(formData);
}

export async function saveStyleTagForm(formData: FormData): Promise<void> {
  await saveStyleTag(formData);
}
