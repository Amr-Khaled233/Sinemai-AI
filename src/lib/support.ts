import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Support conversations between a user and the admin.
 *
 * A thread belongs to the user who opened it; the admin sees all of them. Each
 * side has its own "read up to" time on the thread, and a thread is unread for
 * a side when the newest message came from the other side after that time.
 */

export type Viewer = { id: string; isAdmin: boolean };

type ThreadForUnread = {
  userReadAt: Date | null;
  adminReadAt: Date | null;
  messages: Array<{ fromAdmin: boolean; createdAt: Date }>;
};

/** Whether the newest message is from the other side and newer than this side's last look. */
export function isUnreadFor(thread: ThreadForUnread, viewerIsAdmin: boolean): boolean {
  const last = thread.messages[0];
  if (!last || last.fromAdmin === viewerIsAdmin) return false;
  const readAt = viewerIsAdmin ? thread.adminReadAt : thread.userReadAt;
  return !readAt || last.createdAt > readAt;
}

const lastMessage = { orderBy: { createdAt: 'desc' as const }, take: 1, select: { fromAdmin: true, createdAt: true } };

/** Threads this viewer can see, newest activity first, with an unread flag. */
export async function listThreads(viewer: Viewer) {
  const threads = await prisma.supportThread.findMany({
    where: viewer.isAdmin ? {} : { userId: viewer.id },
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
    include: {
      user: { select: { name: true, email: true, phone: true } },
      messages: lastMessage,
      _count: { select: { messages: true } },
    },
  });
  return threads.map((thread) => ({ ...thread, unread: isUnreadFor(thread, viewer.isAdmin) }));
}

/** How many threads wait for this viewer — the badge on the menu. */
export async function unreadThreadCount(viewer: Viewer) {
  const threads = await prisma.supportThread.findMany({
    where: { closedAt: null, ...(viewer.isAdmin ? {} : { userId: viewer.id }) },
    select: { userReadAt: true, adminReadAt: true, messages: lastMessage },
    take: 500,
  });
  return threads.filter((thread) => isUnreadFor(thread, viewer.isAdmin)).length;
}

/**
 * One thread with its messages, or null when this viewer may not see it. Opening
 * it marks it read for the viewer's side.
 */
export async function openThread(threadId: string, viewer: Viewer) {
  const thread = await prisma.supportThread.findUnique({
    where: { id: threadId },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { sender: { select: { name: true } } },
      },
    },
  });
  if (!thread) return null;
  if (!viewer.isAdmin && thread.userId !== viewer.id) return null;

  await prisma.supportThread.update({
    where: { id: thread.id },
    data: viewer.isAdmin ? { adminReadAt: new Date() } : { userReadAt: new Date() },
  });
  return thread;
}
