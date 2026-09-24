import { Role } from '@prisma/client';

/**
 * Who may read a project.
 *
 * The rule — the owner, or an admin — was written out at four call sites, each
 * free to drift from the others. Posting is deliberately *not* covered by it:
 * an admin may look at a producer's sheet, but sending an inquiry as them is a
 * different question, so those call sites check ownership alone.
 */
export function mayReadProject(
  project: { ownerId: string },
  user: { id: string; role: Role | string },
) {
  return project.ownerId === user.id || user.role === Role.ADMIN;
}
