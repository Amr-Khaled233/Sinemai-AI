'use server';

import { prisma } from '@/lib/prisma';
import {
  addBlockFor,
  deleteInventoryFor,
  removeBlockFor,
  saveInventoryFor,
  toggleInventoryFor,
} from '@/lib/inventory';
import { REVALIDATE, requireVendorProfile, revalidate, runAction } from './shared';

const VENDOR_PAGES = [REVALIDATE.vendorHome, REVALIDATE.vendorInventory] as const;

export async function saveInventoryItem(formData: FormData) {
  return runAction('saveInventoryItem', async () => {
    const { vendor } = await requireVendorProfile();
    await saveInventoryFor({ id: vendor.id, city: vendor.company.city }, formData);
    revalidate(...VENDOR_PAGES);
  });
}

export async function deleteInventoryItem(itemId: string) {
  return runAction('deleteInventoryItem', async () => {
    const { vendor } = await requireVendorProfile();
    await deleteInventoryFor(vendor.id, itemId);
    revalidate(...VENDOR_PAGES);
  });
}

export async function toggleInventoryActive(itemId: string, active: boolean) {
  return runAction('toggleInventoryActive', async () => {
    const { vendor } = await requireVendorProfile();
    await toggleInventoryFor(vendor.id, itemId, active);
    revalidate(...VENDOR_PAGES);
  });
}

export async function addAvailabilityBlock(formData: FormData) {
  return runAction('addAvailabilityBlock', async () => {
    const { vendor } = await requireVendorProfile();
    await addBlockFor(vendor.id, formData);
    revalidate(...VENDOR_PAGES);
  });
}

export async function removeAvailabilityBlock(blockId: string) {
  return runAction('removeAvailabilityBlock', async () => {
    const { vendor } = await requireVendorProfile();
    await removeBlockFor(vendor.id, blockId);
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
