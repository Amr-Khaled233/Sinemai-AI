import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { createResetToken, RESET_TTL_MINUTES } from '@/lib/password-reset';
import { resetEmail, sendEmail } from '@/lib/email';
import { normaliseLocale } from '@/agents/language';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email().max(160),
  locale: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  // The response is identical whether or not the address exists, so this
  // endpoint cannot be used to enumerate accounts.
  if (!parsed.success) return Response.json({ ok: true });

  const locale = normaliseLocale(parsed.data.locale);
  const email = parsed.data.email.toLowerCase().trim();

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true },
  });

  if (user) {
    const token = await createResetToken(user.id);
    const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
    await sendEmail({
      to: user.email,
      subject: locale === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset your Sinemai AI password',
      html: resetEmail({
        name: user.name,
        locale,
        url: `${base}/${locale}/reset-password?token=${token}`,
        ttlMinutes: RESET_TTL_MINUTES,
      }),
    });
  }

  return Response.json({ ok: true });
}
