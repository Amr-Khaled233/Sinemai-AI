'use server';

import { revalidatePath } from 'next/cache';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { availabilityBlockSchema, inventoryItemSchema } from '@/lib/validation';
import { uploadFile } from '@/lib/blob';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireVendor() {
  const session = await auth();
  if (!session?.user || session.user.role !== Role.VENDOR) throw new Error('UNAUTHORIZED');
  const vendor = await prisma.vendor.findUnique({
    where: { userId: session.user.id },
    select: { id: true, status: true, company: { select: { city: true } } },
  });
  if (!vendor) throw new Error('NO_VENDOR_PROFILE');
  return vendor;
}

function revalidateVendor() {
  revalidatePath('/[locale]/vendor', 'page');
  revalidatePath('/[locale]/vendor/inventory', 'page');
}

export async function saveInventoryItem(formData: FormData): Promise<ActionResult> {
  try {
    const vendor = await requireVendor();
    const parsed = inventoryItemSchema.safeParse({
      id: formData.get('id') || undefined,
      equipmentId: formData.get('equipmentId'),
      dailyRate: formData.get('dailyRate'),
      weeklyRate: formData.get('weeklyRate') || undefined,
      monthlyRate: formData.get('monthlyRate') || undefined,
      quantityTotal: formData.get('quantityTotal'),
      quantityAvailable: formData.get('quantityAvailable'),
      city: formData.get('city') || vendor.company.city,
      notes: formData.get('notes') ?? '',
    });
    if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };
    const data = parsed.data;

    if (data.quantityAvailable > data.quantityTotal) {
      return { ok: false, error: 'AVAILABLE_EXCEEDS_TOTAL' };
    }

    const photo = formData.get('photo');
    const photoUrls: string[] = [];
    if (photo instanceof File && photo.size > 0) {
      const stored = await uploadFile(photo, `inventory/${vendor.id}`);
      if (stored.url) photoUrls.push(stored.url);
    }

    const payload = {
      dailyRate: data.dailyRate,
      weeklyRate: data.weeklyRate ?? null,
      monthlyRate: data.monthlyRate ?? null,
      quantityTotal: data.quantityTotal,
      quantityAvailable: data.quantityAvailable,
      city: data.city,
      notes: data.notes || null,
    };

    if (data.id) {
      const owned = await prisma.vendorInventoryItem.findFirst({
        where: { id: data.id, vendorId: vendor.id },
        select: { id: true, photoUrls: true },
      });
      if (!owned) return { ok: false, error: 'NOT_FOUND' };
      await prisma.vendorInventoryItem.update({
        where: { id: owned.id },
        data: {
          ...payload,
          photoUrls: photoUrls.length ? [...owned.photoUrls, ...photoUrls].slice(0, 6) : undefined,
        },
      });
    } else {
      // One row per (vendor, equipment): re-adding the same item updates its rates.
      await prisma.vendorInventoryItem.upsert({
        where: { vendorId_equipmentId: { vendorId: vendor.id, equipmentId: data.equipmentId } },
        create: { vendorId: vendor.id, equipmentId: data.equipmentId, ...payload, photoUrls },
        update: { ...payload, ...(photoUrls.length ? { photoUrls } : {}) },
      });
    }

    revalidateVendor();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' };
  }
}

export async function deleteInventoryItem(itemId: string): Promise<ActionResult> {
  try {
    const vendor = await requireVendor();
    const deleted = await prisma.vendorInventoryItem.deleteMany({
      where: { id: itemId, vendorId: vendor.id },
    });
    if (deleted.count === 0) return { ok: false, error: 'NOT_FOUND' };
    revalidateVendor();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' };
  }
}

export async function toggleInventoryActive(itemId: string, active: boolean): Promise<ActionResult> {
  try {
    const vendor = await requireVendor();
    await prisma.vendorInventoryItem.updateMany({
      where: { id: itemId, vendorId: vendor.id },
      data: { active },
    });
    revalidateVendor();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' };
  }
}

export async function addAvailabilityBlock(formData: FormData): Promise<ActionResult> {
  try {
    const vendor = await requireVendor();
    const parsed = availabilityBlockSchema.safeParse({
      itemId: formData.get('itemId'),
      startDate: formData.get('startDate'),
      endDate: formData.get('endDate'),
      quantity: formData.get('quantity') ?? 1,
      reason: formData.get('reason') ?? '',
    });
    if (!parsed.success) return { ok: false, error: 'INVALID_INPUT' };
    const data = parsed.data;

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return { ok: false, error: 'INVALID_RANGE' };
    }

    const item = await prisma.vendorInventoryItem.findFirst({
      where: { id: data.itemId, vendorId: vendor.id },
      select: { id: true, quantityTotal: true },
    });
    if (!item) return { ok: false, error: 'NOT_FOUND' };

    await prisma.availabilityBlock.create({
      data: {
        itemId: item.id,
        startDate: start,
        endDate: end,
        quantity: Math.min(data.quantity, item.quantityTotal),
        reason: data.reason || null,
      },
    });

    revalidateVendor();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' };
  }
}

export async function removeAvailabilityBlock(blockId: string): Promise<ActionResult> {
  try {
    const vendor = await requireVendor();
    const block = await prisma.availabilityBlock.findFirst({
      where: { id: blockId, item: { vendorId: vendor.id } },
      select: { id: true },
    });
    if (!block) return { ok: false, error: 'NOT_FOUND' };
    await prisma.availabilityBlock.delete({ where: { id: block.id } });
    revalidateVendor();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' };
  }
}

export async function updateCompanyProfile(formData: FormData): Promise<ActionResult> {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.VENDOR) return { ok: false, error: 'UNAUTHORIZED' };
    const vendor = await prisma.vendor.findUnique({
      where: { userId: session.user.id },
      select: { companyId: true },
    });
    if (!vendor) return { ok: false, error: 'NO_VENDOR_PROFILE' };

    await prisma.company.update({
      where: { id: vendor.companyId },
      data: {
        name: String(formData.get('name') ?? '').slice(0, 200) || undefined,
        city: String(formData.get('city') ?? '').slice(0, 80) || undefined,
        phone: String(formData.get('phone') ?? '').slice(0, 40) || null,
        website: String(formData.get('website') ?? '').slice(0, 200) || null,
        addressLine: String(formData.get('addressLine') ?? '').slice(0, 200) || null,
        crNumber: String(formData.get('crNumber') ?? '').slice(0, 40) || null,
      },
    });

    revalidateVendor();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'UNKNOWN' };
  }
}

/** void-returning binding for <form action={...}> in the vendor dashboard. */
export async function updateCompanyProfileForm(formData: FormData): Promise<void> {
  await updateCompanyProfile(formData);
}
