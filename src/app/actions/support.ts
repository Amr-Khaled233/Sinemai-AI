'use server';

import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { effectiveRole } from '@/lib/auth';
import { sendEmail, supportEmail } from '@/lib/email';
import { consumeRateLimit, LIMITS } from '@/lib/rate-limit';
import { REVALIDATE, requireSession, revalidate, runAction } from './shared';

const messageSchema = z.string().trim().min(2).max(4000);
const subjectSchema = z.string().trim().min(3).max(160);

function siteUrl() {
  return process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
}

async function throttle(userId: string) {
  const limit = await consumeRateLimit(`support:${userId}`, LIMITS.support);
  if (!limit.allowed) throw new Error('RATE_LIMITED');
}

/** Mail the other side. Best effort: a message is saved even if the mail is not. */
async function notify(args: {
  to: string[];
  fromName: string;
  subject: string;
  message: string;
  url: string;
}) {
  if (args.to.length === 0) return;
  await sendEmail({
    to: args.to,
    subject: `Sinemai AI · ${args.subject.replace(/\s+/g, ' ').slice(0, 100)}`,
    html: supportEmail(args),
  }).catch(() => undefined);
}

async function adminEmails() {
  const admins = await prisma.user.findMany({ where: { role: Role.ADMIN }, select: { email: true } });
  return admins.map((admin) => admin.email);
}

/** A user opens a conversation with the admin. */
export async function startSupportThread(formData: FormData) {
  return runAction('startSupportThread', async () => {
    const user = await requireSession();
    const subject = subjectSchema.safeParse(formData.get('subject'));
    const body = messageSchema.safeParse(formData.get('message'));
    if (!subject.success || !body.success) throw new Error('INVALID_INPUT');
    await throttle(user.id);

    const now = new Date();
    const thread = await prisma.supportThread.create({
      data: {
        userId: user.id,
        subject: subject.data,
        lastMessageAt: now,
        userReadAt: now,
        messages: { create: { senderId: user.id, fromAdmin: false, body: body.data, createdAt: now } },
      },
      select: { id: true },
    });

    await notify({
      to: await adminEmails(),
      fromName: user.name ?? user.email ?? '',
      subject: subject.data,
      message: body.data,
      url: `${siteUrl()}/en/admin/support/${thread.id}`,
    });
    revalidate(REVALIDATE.userSupport, REVALIDATE.adminSupport);
    return { threadId: thread.id };
  });
}

/**
 * A reply from either side. The user may only write in their own thread; the
 * admin may write in any. A reply reopens a closed thread.
 */
export async function replyToSupportThread(threadId: string, formData: FormData) {
  return runAction('replyToSupportThread', async () => {
    const user = await requireSession();
    const isAdmin = effectiveRole(user.role) === 'ADMIN';
    const body = messageSchema.safeParse(formData.get('message'));
    if (!body.success) throw new Error('INVALID_INPUT');

    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      select: { id: true, userId: true, subject: true, user: { select: { email: true, locale: true } } },
    });
    if (!thread || (!isAdmin && thread.userId !== user.id)) throw new Error('NOT_FOUND');
    await throttle(user.id);

    const now = new Date();
    await prisma.$transaction([
      prisma.supportMessage.create({
        data: { threadId: thread.id, senderId: user.id, fromAdmin: isAdmin, body: body.data, createdAt: now },
      }),
      prisma.supportThread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt: now,
          closedAt: null,
          ...(isAdmin ? { adminReadAt: now } : { userReadAt: now }),
        },
      }),
    ]);

    await notify(
      isAdmin
        ? {
            to: [thread.user.email],
            fromName: 'Sinemai AI',
            subject: thread.subject,
            message: body.data,
            url: `${siteUrl()}/${thread.user.locale}/producer/support/${thread.id}`,
          }
        : {
            to: await adminEmails(),
            fromName: user.name ?? user.email ?? '',
            subject: thread.subject,
            message: body.data,
            url: `${siteUrl()}/en/admin/support/${thread.id}`,
          },
    );
    revalidate(REVALIDATE.userSupport, REVALIDATE.adminSupport);
  });
}

/** Either side may close a conversation; a new message reopens it. */
export async function setSupportThreadClosed(threadId: string, closed: boolean) {
  return runAction('setSupportThreadClosed', async () => {
    const user = await requireSession();
    const isAdmin = effectiveRole(user.role) === 'ADMIN';
    const updated = await prisma.supportThread.updateMany({
      where: { id: threadId, ...(isAdmin ? {} : { userId: user.id }) },
      data: { closedAt: closed ? new Date() : null },
    });
    if (updated.count === 0) throw new Error('NOT_FOUND');
    revalidate(REVALIDATE.userSupport, REVALIDATE.adminSupport);
  });
}
