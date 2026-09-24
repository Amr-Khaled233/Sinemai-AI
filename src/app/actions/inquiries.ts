'use server';

import { InquiryStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { inquiryReplyEmail, sendEmail } from '@/lib/email';
import { consumeRateLimit, LIMITS } from '@/lib/rate-limit';
import { REVALIDATE, requireSession, revalidate, runAction } from './shared';

/**
 * Inquiry threads.
 *
 * An inquiry used to be fire-and-forget: the producer sent one, the recipient
 * got an email, and the platform lost sight of it. Keeping the conversation
 * here means both sides can see whether it was read, replied to or closed —
 * and the introduction the platform made stays visible to it.
 */

const INQUIRY_PAGES = [
  REVALIDATE.producerInquiries,
  REVALIDATE.vendorInquiries,
  REVALIDATE.dopInquiries,
] as const;

type Participant = { role: 'SENDER' | 'RECIPIENT'; counterpartEmail: string; counterpartName: string };

/**
 * Loads an inquiry only for the two people in it: the producer who sent it and
 * the vendor or cinematographer it was addressed to. An admin can read one for
 * support, but never post into it.
 */
async function participantFor(inquiryId: string, userId: string, role: Role) {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: {
      id: true,
      fromUserId: true,
      status: true,
      subject: true,
      closedAt: true,
      fromUser: { select: { name: true, email: true } },
      project: { select: { name: true } },
      dop: { select: { displayName: true, user: { select: { id: true, email: true } } } },
      vendor: {
        select: {
          company: { select: { name: true } },
          user: { select: { id: true, email: true } },
        },
      },
    },
  });
  if (!inquiry) throw new Error('NOT_FOUND');

  const recipientUserId = inquiry.dop?.user.id ?? inquiry.vendor?.user.id ?? null;
  const recipientEmail = inquiry.dop?.user.email ?? inquiry.vendor?.user.email ?? null;
  const recipientName = inquiry.dop?.displayName ?? inquiry.vendor?.company.name ?? 'Sinemai AI';

  let participant: Participant | null = null;
  if (userId === inquiry.fromUserId && recipientEmail) {
    participant = { role: 'SENDER', counterpartEmail: recipientEmail, counterpartName: recipientName };
  } else if (recipientUserId && userId === recipientUserId) {
    participant = {
      role: 'RECIPIENT',
      counterpartEmail: inquiry.fromUser.email,
      counterpartName: inquiry.fromUser.name,
    };
  }

  if (!participant && role !== Role.ADMIN) throw new Error('FORBIDDEN');
  return { inquiry, participant };
}

export async function replyToInquiry(inquiryId: string, body: string) {
  return runAction('replyToInquiry', async () => {
    const user = await requireSession();
    const text = body.trim();
    if (text.length < 2 || text.length > 4000) throw new Error('INVALID_INPUT');

    const { inquiry, participant } = await participantFor(inquiryId, user.id, user.role);
    // Admins can read a thread for support, but the conversation belongs to
    // the two parties.
    if (!participant) throw new Error('FORBIDDEN');
    if (inquiry.closedAt) throw new Error('INQUIRY_CLOSED');

    const limit = await consumeRateLimit(`inquiry-reply:${user.id}`, LIMITS.inquiry);
    if (!limit.allowed) throw new Error('RATE_LIMITED');

    const now = new Date();
    await prisma.$transaction([
      prisma.inquiryMessage.create({
        data: { inquiryId, senderId: user.id, body: text },
      }),
      prisma.inquiry.update({
        where: { id: inquiryId },
        data: {
          lastMessageAt: now,
          // A reply from the recipient is what moves the thread forward; the
          // producer following up does not downgrade an already-replied thread.
          status:
            participant.role === 'RECIPIENT'
              ? InquiryStatus.REPLIED
              : inquiry.status === InquiryStatus.SENT
                ? InquiryStatus.SENT
                : inquiry.status,
          readAt: participant.role === 'RECIPIENT' ? (inquiry.status === InquiryStatus.SENT ? now : undefined) : undefined,
        },
      }),
    ]);

    await sendEmail({
      to: participant.counterpartEmail,
      subject: `[Sinemai AI] ${inquiry.subject}`,
      html: inquiryReplyEmail({
        recipientName: participant.counterpartName,
        senderName: user.name ?? 'Sinemai AI',
        subject: inquiry.subject,
        message: text,
        projectName: inquiry.project?.name ?? null,
      }),
    });

    revalidate(...INQUIRY_PAGES);
    return { sent: true };
  });
}

/** Marks a thread read the first time its recipient opens it. */
export async function markInquiryRead(inquiryId: string) {
  return runAction('markInquiryRead', async () => {
    const user = await requireSession();
    const { inquiry, participant } = await participantFor(inquiryId, user.id, user.role);
    if (participant?.role !== 'RECIPIENT' || inquiry.status !== InquiryStatus.SENT) return;

    await prisma.inquiry.update({
      where: { id: inquiryId },
      data: { status: InquiryStatus.READ, readAt: new Date() },
    });
    revalidate(...INQUIRY_PAGES);
  });
}

export async function setInquiryClosed(inquiryId: string, closed: boolean) {
  return runAction('setInquiryClosed', async () => {
    const user = await requireSession();
    const { participant } = await participantFor(inquiryId, user.id, user.role);
    if (!participant) throw new Error('FORBIDDEN');

    await prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        closedAt: closed ? new Date() : null,
        status: closed ? InquiryStatus.CLOSED : InquiryStatus.REPLIED,
      },
    });
    revalidate(...INQUIRY_PAGES);
  });
}
