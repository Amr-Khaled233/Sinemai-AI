import { Role } from '@prisma/client';

/**
 * Who may read a project.
 *
 * The rule — the owner, or an admin — was written out at four call sites, each
 * free to drift from the others, so it lives here once.
 */
export function mayReadProject(
  project: { ownerId: string },
  user: { id: string; role: Role | string },
) {
  return project.ownerId === user.id || user.role === Role.ADMIN;
}
