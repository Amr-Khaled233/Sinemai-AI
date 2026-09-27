import { z } from 'zod';
import { BudgetTier, ProjectType } from '@prisma/client';
import { isSafeHttpUrl } from '@/lib/security';

/**
 * Public sign-up creates producer accounts only. There is no role field on
 * purpose: a role sent by the browser would be a role the browser chose.
 * Vendor and cinematographer accounts are provisioned by an admin.
 */
export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(160),
  password: z.string().min(8).max(200),
  phone: z.string().max(40).optional().or(z.literal('')),
  locale: z.enum(['ar', 'en']).default('en'),
});

export const projectSchema = z.object({
  name: z.string().min(2).max(160),
  type: z.nativeEnum(ProjectType),
  budgetTier: z.nativeEnum(BudgetTier),
  city: z.string().min(2).max(80),
  visualStyleTags: z.array(z.string().max(60)).max(8),
  shootStartDate: z.string().optional().or(z.literal('')),
  shootEndDate: z.string().optional().or(z.literal('')),
  synopsis: z.string().max(2000).optional().or(z.literal('')),
});

export const inventoryItemSchema = z.object({
  id: z.string().optional(),
  equipmentId: z.string().min(1),
  dailyRate: z.coerce.number().int().min(1).max(200_000),
  weeklyRate: z.coerce.number().int().min(0).max(1_000_000).optional(),
  monthlyRate: z.coerce.number().int().min(0).max(4_000_000).optional(),
  quantityTotal: z.coerce.number().int().min(1).max(500),
  quantityAvailable: z.coerce.number().int().min(0).max(500),
  city: z.string().min(2).max(80),
  notes: z.string().max(400).optional().or(z.literal('')),
});

export const availabilityBlockSchema = z.object({
  itemId: z.string().min(1),
  startDate: z.string().min(8),
  endDate: z.string().min(8),
  quantity: z.coerce.number().int().min(1).max(500),
  reason: z.string().max(160).optional().or(z.literal('')),
});

export const rentalCompanySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(40),
  email: z.string().trim().email().max(160).or(z.literal('')),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === '' || isSafeHttpUrl(value), { message: 'URL must start with http:// or https://' }),
  crNumber: z.string().trim().max(40),
});

