import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Thread } from '@/components/inquiry-thread';

/**
 * Loading inquiry threads.
 *
 * The opening message lives on the Inquiry row (it is what the producer typed
 * when they first reached out) and replies live in InquiryMessage. Both are
 * flattened here so a thread reads as one ordered conversation everywhere.
 */

const INCLUDE = {
  fromUser: { select: { id: true, name: true } },
  project: { select: { name: true } },
  dop: { select: { displayName: true, user: { select: { id: true } } } },
  vendor: { select: { company: { select: { name: true } }, user: { select: { id: true } } } },
  messages: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, body: true, createdAt: true, sender: { select: { id: true, name: true } } },
  },
} satisfies Prisma.InquiryInclude;

type Row = Prisma.InquiryGetPayload<{ include: typeof INCLUDE }>;

function toThread(row: Row, viewerId: string): Thread {
  const recipientName = row.dop?.displayName ?? row.vendor?.company.name ?? '—';
  const viewerIsSender = viewerId === row.fromUserId;

  const opening = {
    id: `opening-${row.id}`,
    body: row.message,
    createdAt: row.createdAt.toISOString(),
    senderName: row.fromUser.name,
    mine: viewerIsSender,
  };

  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    // Each side sees who they are talking to, not their own name.
    counterpartName: viewerIsSender ? recipientName : row.fromUser.name,
    projectName: row.project?.name ?? null,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    createdAt: row.createdAt.toISOString(),
    closed: row.closedAt !== null,
    messages: [
      opening,
      ...row.messages.map((message) => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
        senderName: message.sender.name,
        mine: message.sender.id === viewerId,
      })),
    ],
  };
}

/** Threads a producer started. */
export async function loadSentThreads(userId: string) {
  const rows = await prisma.inquiry.findMany({
    where: { fromUserId: userId },
    orderBy: { lastMessageAt: 'desc' },
    include: INCLUDE,
    take: 100,
  });
  return rows.map((row) => toThread(row, userId));
}

/** Threads addressed to this vendor or cinematographer. */
export async function loadReceivedThreads(userId: string, target: 'vendor' | 'dop') {
  const rows = await prisma.inquiry.findMany({
    where: target === 'vendor' ? { vendor: { userId } } : { dop: { userId } },
    orderBy: { lastMessageAt: 'desc' },
    include: INCLUDE,
    take: 100,
  });
  return rows.map((row) => toThread(row, userId));
}

/** Unread count for the navigation badge. */
export async function countUnreadInquiries(userId: string, target: 'vendor' | 'dop') {
  return prisma.inquiry.count({
    where: {
      status: 'SENT',
      ...(target === 'vendor' ? { vendor: { userId } } : { dop: { userId } }),
    },
  });
}
