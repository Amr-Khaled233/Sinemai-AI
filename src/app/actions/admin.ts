'use server';

import {
  ApprovalStatus,
  BudgetTier,
  CameraMovement,
  Complexity,
  DayNightSuitability,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { approvalEmail, sendEmail } from '@/lib/email';
import { saveSettings, type PlatformSettings } from '@/lib/settings';
import { buildDopEmbeddingText, embedText, writeDopEmbedding } from '@/lib/embeddings';
import { slugify } from '@/lib/utils';
import { REVALIDATE, requireAdmin, revalidate, runAction } from './shared';

function baseUrl() {
  return process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

// ---------------------------------------------------------------- approvals

export async function setVendorStatus(vendorId: string, status: ApprovalStatus, reason?: string) {
  return runAction('setVendorStatus', async () => {
    await requireAdmin();
    const approved = status === ApprovalStatus.APPROVED;

    const vendor = await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        status,
        verified: approved,
        approvedAt: approved ? new Date() : null,
        notes: reason ?? null,
      },
      select: {
        user: { select: { email: true, name: true, locale: true } },
        company: { select: { id: true } },
      },
    });

    await prisma.company.update({ where: { id: vendor.company.id }, data: { verified: approved } });

    await sendEmail({
      to: vendor.user.email,
      subject: approved
        ? 'Your Sinemai AI vendor listing is live'
        : 'Your Sinemai AI vendor application needs changes',
      html: approvalEmail({
        name: vendor.user.name,
        approved,
        reason,
        loginUrl: `${baseUrl()}/${vendor.user.locale}/vendor`,
      }),
    });

    revalidate(REVALIDATE.adminVendors, REVALIDATE.adminHome);
  });
}

export async function setDopStatus(dopId: string, status: ApprovalStatus, reason?: string) {
  return runAction('setDopStatus', async () => {
    await requireAdmin();
    const approved = status === ApprovalStatus.APPROVED;

    const dop = await prisma.dop.update({
      where: { id: dopId },
      data: { status, approvedAt: approved ? new Date() : null },
      select: {
        id: true,
        displayName: true,
        bio: true,
        styleTags: true,
        city: true,
        yearsExperience: true,
        embeddedAt: true,
        user: { select: { email: true, name: true, locale: true } },
      },
    });

    // An approved profile needs a style vector before it can ever be matched.
    if (approved && !dop.embeddedAt && process.env.OPENAI_API_KEY) {
      try {
        const text = buildDopEmbeddingText(dop);
        await writeDopEmbedding(dop.id, text, await embedText(text));
      } catch (error) {
        console.warn('[admin:approve-dop] embedding deferred to cron', error);
      }
    }

    await sendEmail({
      to: dop.user.email,
      subject: approved
        ? 'Your Sinemai AI cinematographer profile is live'
        : 'Your Sinemai AI profile needs changes',
      html: approvalEmail({
        name: dop.user.name,
        approved,
        reason,
        loginUrl: `${baseUrl()}/${dop.user.locale}/dop`,
      }),
    });

    revalidate(REVALIDATE.adminDops, REVALIDATE.adminHome);
  });
}

export async function toggleVendorVerified(vendorId: string, verified: boolean) {
  return runAction('toggleVendorVerified', async () => {
    await requireAdmin();
    const vendor = await prisma.vendor.update({
      where: { id: vendorId },
      data: { verified },
      select: { companyId: true },
    });
    await prisma.company.update({ where: { id: vendor.companyId }, data: { verified } });
    revalidate(REVALIDATE.adminVendors);
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
