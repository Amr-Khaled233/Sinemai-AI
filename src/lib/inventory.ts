import 'server-only';
import { prisma } from '@/lib/prisma';
import { availabilityBlockSchema, inventoryItemSchema } from '@/lib/validation';
import { uploadFile } from '@/lib/blob';

/**
 * Rental inventory writes, scoped to one vendor.
 *
 * A vendor edits their own stock; an admin can edit any vendor's. Both go
 * through these functions with the vendor already resolved by the caller's
 * guard, so every query below is pinned to that vendor's id and an item id
 * from someone else's stock is simply NOT_FOUND. The functions throw the same
 * allow-listed codes the actions report.
 */

export type InventoryOwner = { id: string; city: string };

export async function saveInventoryFor(owner: InventoryOwner, formData: FormData) {
  const parsed = inventoryItemSchema.safeParse({
    id: formData.get('id') || undefined,
    equipmentId: formData.get('equipmentId'),
    dailyRate: formData.get('dailyRate'),
    weeklyRate: formData.get('weeklyRate') || undefined,
    monthlyRate: formData.get('monthlyRate') || undefined,
    quantityTotal: formData.get('quantityTotal'),
    quantityAvailable: formData.get('quantityAvailable'),
    city: formData.get('city') || owner.city,
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) throw new Error('INVALID_INPUT');
  const data = parsed.data;

  if (data.quantityAvailable > data.quantityTotal) throw new Error('AVAILABLE_EXCEEDS_TOTAL');

  const photo = formData.get('photo');
  const photoUrls: string[] = [];
  if (photo instanceof File && photo.size > 0) {
    const stored = await uploadFile(photo, `inventory/${owner.id}`, 'image');
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
      where: { id: data.id, vendorId: owner.id },
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
    return;
  }

  // One row per (vendor, equipment): re-adding the same item updates its rates.
  await prisma.vendorInventoryItem.upsert({
    where: { vendorId_equipmentId: { vendorId: owner.id, equipmentId: data.equipmentId } },
    create: { vendorId: owner.id, equipmentId: data.equipmentId, ...payload, photoUrls },
    update: { ...payload, ...(photoUrls.length ? { photoUrls } : {}) },
  });
}

export async function deleteInventoryFor(vendorId: string, itemId: string) {
  const deleted = await prisma.vendorInventoryItem.deleteMany({ where: { id: itemId, vendorId } });
  if (deleted.count === 0) throw new Error('NOT_FOUND');
}

export async function toggleInventoryFor(vendorId: string, itemId: string, active: boolean) {
  const updated = await prisma.vendorInventoryItem.updateMany({ where: { id: itemId, vendorId }, data: { active } });
  if (updated.count === 0) throw new Error('NOT_FOUND');
}

export async function addBlockFor(vendorId: string, formData: FormData) {
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
    where: { id: data.itemId, vendorId },
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
}

export async function removeBlockFor(vendorId: string, blockId: string) {
  const block = await prisma.availabilityBlock.findFirst({
    where: { id: blockId, item: { vendorId } },
    select: { id: true },
  });
  if (!block) throw new Error('NOT_FOUND');
  await prisma.availabilityBlock.delete({ where: { id: block.id } });
}
