import { NextResponse } from 'next/server';
import { InquiryTargetType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { inquirySchema } from '@/lib/validation';
import { inquiryEmail, sendEmail } from '@/lib/email';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const parsed = inquirySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  const data = parsed.data;

  // Producers may only attach an inquiry to a project they own.
  if (data.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: data.projectId },
      select: { ownerId: true },
    });
    if (!project || project.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
  }

  const isDop = data.targetType === 'DOP';

  const target = isDop
    ? await prisma.dop.findFirst({
        where: { id: data.targetId, status: 'APPROVED' },
        select: { id: true, displayName: true, user: { select: { email: true } } },
      })
    : await prisma.vendor.findFirst({
        where: { id: data.targetId, status: 'APPROVED' },
        select: {
          id: true,
          user: { select: { email: true } },
          company: { select: { name: true } },
        },
      });

  if (!target) return NextResponse.json({ error: 'TARGET_NOT_FOUND' }, { status: 404 });

  const recipientEmail = target.user.email;
  const recipientName = isDop
    ? (target as { displayName: string }).displayName
    : (target as { company: { name: string } }).company.name;

  const project = data.projectId
    ? await prisma.project.findUnique({ where: { id: data.projectId }, select: { name: true } })
    : null;

  const inquiry = await prisma.inquiry.create({
    data: {
      projectId: data.projectId ?? null,
      fromUserId: session.user.id,
      targetType: isDop ? InquiryTargetType.DOP : InquiryTargetType.VENDOR,
      dopId: isDop ? target.id : null,
      vendorId: isDop ? null : target.id,
      subject: data.subject,
      message: data.message,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone || null,
    },
    select: { id: true },
  });

  await sendEmail({
    to: recipientEmail,
    subject: `[Sinemai AI] ${data.subject}`,
    replyTo: data.contactEmail,
    html: inquiryEmail({
      recipientName,
      producerName: session.user.name ?? 'A producer',
      projectName: project?.name ?? null,
      subject: data.subject,
      message: data.message,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone || null,
    }),
  });

  return NextResponse.json({ ok: true, id: inquiry.id });
}
