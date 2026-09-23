import { z } from 'zod';
import { BudgetTier, ProjectType, Role } from '@prisma/client';

export const registerSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(160),
    password: z.string().min(8).max(200),
    phone: z.string().max(40).optional().or(z.literal('')),
    role: z.enum([Role.PRODUCER, Role.VENDOR, Role.DOP]),
    locale: z.enum(['ar', 'en']).default('ar'),
    // vendors only
    companyName: z.string().max(200).optional(),
    crNumber: z.string().max(40).optional(),
    city: z.string().max(80).optional(),
  })
  .refine((data) => data.role !== Role.VENDOR || Boolean(data.companyName && data.city), {
    message: 'Vendors must provide a company name and city.',
    path: ['companyName'],
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

export const inquirySchema = z.object({
  projectId: z.string().optional(),
  targetType: z.enum(['DOP', 'VENDOR']),
  targetId: z.string().min(1),
  subject: z.string().min(3).max(160),
  message: z.string().min(10).max(4000),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(40).optional().or(z.literal('')),
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

export const dopProfileSchema = z.object({
  displayName: z.string().min(2).max(120),
  displayNameAr: z.string().max(120).optional().or(z.literal('')),
  bio: z.string().min(40).max(4000),
  city: z.string().max(80).optional().or(z.literal('')),
  dayRate: z.coerce.number().int().min(0).max(200_000).optional(),
  yearsExperience: z.coerce.number().int().min(0).max(70).optional(),
  portfolioLinks: z.array(z.string().url().max(400)).max(10),
  styleTags: z.array(z.string().max(60)).min(1).max(10),
});
