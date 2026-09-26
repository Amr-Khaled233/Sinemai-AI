'use server';

import { z } from 'zod';
import { repricePackage } from '@/lib/package-edit';
import { REVALIDATE, requireOwnedProject, revalidate, runAction } from './shared';

/**
 * Editing the recommended package.
 *
 * The agents propose; the producer decides. Dropping a light, adding a second
 * body or cutting a rental from five days to three is the first thing anyone
 * does with a quote. The pricing itself lives in repricePackage, which the
 * project chat uses too.
 */

const editSchema = z.object({
  items: z
    .array(
      z.object({
        equipmentId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(20),
        rentalDays: z.coerce.number().int().min(1).max(180),
      }),
    )
    .max(40),
});

export type PackageEdit = z.infer<typeof editSchema>['items'][number];

export async function updateEquipmentPackage(projectId: string, items: PackageEdit[]) {
  return runAction('updateEquipmentPackage', async () => {
    const { project } = await requireOwnedProject(projectId);

    const parsed = editSchema.safeParse({ items });
    if (!parsed.success) throw new Error('INVALID_INPUT');
    if (parsed.data.items.length === 0) throw new Error('PACKAGE_EMPTY');

    const result = await repricePackage(project.id, parsed.data.items);
    revalidate(REVALIDATE.producerProject, REVALIDATE.producerProjects);
    return result;
  });
}
