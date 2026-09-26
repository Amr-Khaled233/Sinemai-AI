import { NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/validation';
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
      role: Role.PRODUCER,
      locale: data.locale,
    },
    select: { role: true },
  });

  return NextResponse.json({ ok: true, role: user.role });
}
