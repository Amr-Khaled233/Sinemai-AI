import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/validation';
import { sendEmail } from '@/lib/email';
import { clientIp, consumeRateLimit, LIMITS, rateLimitResponse } from '@/lib/rate-limit';
import { crossOriginRejected, isSameOrigin } from '@/lib/security';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return crossOriginRejected();

  const limit = await consumeRateLimit(`register:${clientIp(request)}`, LIMITS.register);
  if (!limit.allowed) return rateLimitResponse(limit);

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_INPUT', issues: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const email = data.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });

  const passwordHash = await hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name: data.name,
      phone: data.phone || null,
      passwordHash,
      role: data.role,
      locale: data.locale,
    },
    select: { id: true, role: true, name: true },
  });

  // Vendors and DOPs get a listing in PENDING state — an admin has to approve it
  // before producers can be matched to them.
  if (data.role === Role.VENDOR) {
    const company = await prisma.company.create({
      data: {
        name: data.companyName ?? data.name,
        crNumber: data.crNumber || null,
        city: data.city ?? 'Riyadh',
        phone: data.phone || null,
      },
      select: { id: true },
    });
    await prisma.vendor.create({ data: { userId: user.id, companyId: company.id } });
  }

  if (data.role === Role.DOP) {
    await prisma.dop.create({
      data: {
        userId: user.id,
        displayName: data.name,
        city: data.city || null,
      },
    });
  }

  if (data.role !== Role.PRODUCER) {
    const admins = await prisma.user.findMany({ where: { role: Role.ADMIN }, select: { email: true } });
    if (admins.length) {
      await sendEmail({
        to: admins.map((a) => a.email),
        subject: `New ${data.role.toLowerCase()} application: ${data.name}`,
        html: `<p>${data.name} (${email}) applied as ${data.role}. Review it in the admin approval queue.</p>`,
      });
    }
  }

  return NextResponse.json({ ok: true, role: user.role, pending: data.role !== Role.PRODUCER });
}
