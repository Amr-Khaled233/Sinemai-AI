import 'server-only';
import { revalidatePath } from 'next/cache';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { publicError } from '@/lib/security';

/**
 * The shared spine of every server action.
 *
 * Before this existed, each action repeated the same four things by hand — a
 * role guard, a try/catch, an error-code mapping and a revalidate path written
 * as a raw string. That is four chances per action to forget one, and the path
 * strings in particular are silent when wrong: a typo simply means the page
 * never refreshes.
 */

export type ActionResult<T = unknown> =
  | ({ ok: true } & (T extends unknown ? Partial<T> : T))
  | { ok: false; error: string };

export type Ok = { ok: true };
export type Failed = { ok: false; error: string };

/**
 * Route patterns for `revalidatePath`. They must be the route *pattern*, not a
 * concrete URL — `/producer/projects/abc` silently matches nothing, while
 * `/[locale]/producer/projects/[id]` matches every locale and every project.
 */
export const REVALIDATE = {
  producerProjects: '/[locale]/producer',
  producerProject: '/[locale]/producer/projects/[id]',
  producerInquiries: '/[locale]/producer/inquiries',
  vendorHome: '/[locale]/vendor',
  vendorInventory: '/[locale]/vendor/inventory',
  vendorInquiries: '/[locale]/vendor/inquiries',
  dopProfile: '/[locale]/dop',
  dopInquiries: '/[locale]/dop/inquiries',
  adminHome: '/[locale]/admin',
  adminEquipment: '/[locale]/admin/equipment',
  adminVendors: '/[locale]/admin/vendors',
  adminDops: '/[locale]/admin/dops',
  adminSettings: '/[locale]/admin/settings',
} as const;

export function revalidate(...paths: Array<(typeof REVALIDATE)[keyof typeof REVALIDATE]>) {
  for (const path of paths) revalidatePath(path, 'page');
}

// ---------------------------------------------------------------- guards

/**
 * Guards throw a bare code rather than returning it, so an action body reads as
 * the happy path and `runAction` turns any throw into a safe result.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error('UNAUTHORIZED');
  return session.user;
}

export async function requireRoles(...roles: Role[]) {
  const user = await requireSession();
  if (!roles.includes(user.role)) throw new Error('FORBIDDEN');
  return user;
}

export async function requireAdmin() {
  return requireRoles(Role.ADMIN);
}

/** Producers own projects; an admin can act on any of them for support. */
export async function requireProducer() {
  return requireRoles(Role.PRODUCER, Role.ADMIN);
}

export async function requireVendorProfile() {
  const user = await requireRoles(Role.VENDOR);
  const vendor = await prisma.vendor.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true, companyId: true, company: { select: { city: true } } },
  });
  if (!vendor) throw new Error('NOT_FOUND');
  return { user, vendor };
}

export async function requireDopProfile() {
  const user = await requireRoles(Role.DOP);
  const dop = await prisma.dop.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!dop) throw new Error('NOT_FOUND');
  return { user, dop };
}

/** Loads a project only if the caller owns it (or is an admin). */
export async function requireOwnedProject(projectId: string) {
  const user = await requireProducer();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, script: { select: { id: true, fileUrl: true } } },
  });
  if (!project) throw new Error('NOT_FOUND');
  if (project.ownerId !== user.id && user.role !== Role.ADMIN) throw new Error('FORBIDDEN');
  return { user, project };
}

// ---------------------------------------------------------------- wrapper

/**
 * Runs an action body and converts any throw into `{ ok: false }` with an
 * allow-listed code. Unknown failures are logged server-side and reported
 * generically, so Prisma internals never reach the browser.
 */
export async function runAction<T extends object>(
  context: string,
  body: () => Promise<T | void>,
): Promise<({ ok: true } & T) | Failed> {
  try {
    const result = (await body()) ?? ({} as T);
    return { ok: true, ...(result as T) };
  } catch (error) {
    return { ok: false, error: publicError(error, context) };
  }
}
