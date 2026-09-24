'use server';

import { prisma } from '@/lib/prisma';
import { availabilityBlockSchema, inventoryItemSchema } from '@/lib/validation';
import { uploadFile } from '@/lib/blob';
import { REVALIDATE, requireVendorProfile, revalidate, runAction } from './shared';

const VENDOR_PAGES = [REVALIDATE.vendorHome, REVALIDATE.vendorInventory] as const;

export async function saveInventoryItem(formData: FormData) {
  return runAction('saveInventoryItem', async () => {
    const { vendor } = await requireVendorProfile();

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
    if (!parsed.success) throw new Error('INVALID_INPUT');
    const data = parsed.data;

    if (data.quantityAvailable > data.quantityTotal) throw new Error('AVAILABLE_EXCEEDS_TOTAL');

    const photo = formData.get('photo');
    const photoUrls: string[] = [];
    if (photo instanceof File && photo.size > 0) {
      const stored = await uploadFile(photo, `inventory/${vendor.id}`, 'image');
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
      if (!owned) throw new Error('NOT_FOUND');
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

    revalidate(...VENDOR_PAGES);
  });
}

export async function deleteInventoryItem(itemId: string) {
  return runAction('deleteInventoryItem', async () => {
    const { vendor } = await requireVendorProfile();
    const deleted = await prisma.vendorInventoryItem.deleteMany({
      where: { id: itemId, vendorId: vendor.id },
    });
    if (deleted.count === 0) throw new Error('NOT_FOUND');
    revalidate(...VENDOR_PAGES);
  });
}

export async function toggleInventoryActive(itemId: string, active: boolean) {
  return runAction('toggleInventoryActive', async () => {
    const { vendor } = await requireVendorProfile();
    const updated = await prisma.vendorInventoryItem.updateMany({
      where: { id: itemId, vendorId: vendor.id },
      data: { active },
    });
    if (updated.count === 0) throw new Error('NOT_FOUND');
    revalidate(...VENDOR_PAGES);
  });
}

export async function addAvailabilityBlock(formData: FormData) {
  return runAction('addAvailabilityBlock', async () => {
    const { vendor } = await requireVendorProfile();

    const parsed = availabilityBlockSchema.safeParse({
      itemId: formData.get('itemId'),
      startDate: formData.get('startDate'),
      endDate: formData.get('endDate'),
      quantity: formData.get('quantity') ?? 1,
      reason: formData.get('reason') ?? '',
    });
    if (!parsed.success) throw new Error('INVALID_INPUT');
    const data = parsed.data;

    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      throw new Error('INVALID_RANGE');
    }

    const item = await prisma.vendorInventoryItem.findFirst({
      where: { id: data.itemId, vendorId: vendor.id },
      select: { id: true, quantityTotal: true },
    });
    if (!item) throw new Error('NOT_FOUND');

    await prisma.availabilityBlock.create({
      data: {
        itemId: item.id,
        startDate: start,
        endDate: end,
        quantity: Math.min(data.quantity, item.quantityTotal),
        reason: data.reason || null,
      },
    });

    revalidate(...VENDOR_PAGES);
  });
}

export async function removeAvailabilityBlock(blockId: string) {
  return runAction('removeAvailabilityBlock', async () => {
    const { vendor } = await requireVendorProfile();
    const block = await prisma.availabilityBlock.findFirst({
      where: { id: blockId, item: { vendorId: vendor.id } },
      select: { id: true },
    });
    if (!block) throw new Error('NOT_FOUND');
    await prisma.availabilityBlock.delete({ where: { id: block.id } });
    revalidate(...VENDOR_PAGES);
  });
}

export async function updateCompanyProfile(formData: FormData) {
  return runAction('updateCompanyProfile', async () => {
    const { vendor } = await requireVendorProfile();
    const text = (field: string, max: number) => String(formData.get(field) ?? '').trim().slice(0, max);

    const name = text('name', 200);
    const city = text('city', 80);
    if (!name || !city) throw new Error('INVALID_INPUT');

    await prisma.company.update({
      where: { id: vendor.companyId },
      data: {
        name,
        city,
        phone: text('phone', 40) || null,
        website: text('website', 200) || null,
        addressLine: text('addressLine', 200) || null,
        crNumber: text('crNumber', 40) || null,
      },
    });

    revalidate(...VENDOR_PAGES);
  });
}

/** void-returning binding for <form action={...}> in the vendor dashboard. */
export async function updateCompanyProfileForm(formData: FormData): Promise<void> {
  await updateCompanyProfile(formData);
}
