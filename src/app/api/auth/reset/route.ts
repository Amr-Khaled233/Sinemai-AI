import { z } from 'zod';
import { hash } from 'bcryptjs';
import { consumeResetToken, lookupResetToken } from '@/lib/password-reset';

export const runtime = 'nodejs';

const schema = z.object({
  token: z.string().min(16).max(200),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'INVALID_INPUT' }, { status: 400 });

  const lookup = await lookupResetToken(parsed.data.token);
  if (!lookup.ok) return Response.json({ error: lookup.reason }, { status: 400 });

  await consumeResetToken(lookup.tokenId, lookup.userId, await hash(parsed.data.password, 12));
  return Response.json({ ok: true });
}

/** Lets the reset page tell the user a link is dead before they type a password. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const lookup = await lookupResetToken(token);
  return Response.json(lookup.ok ? { valid: true } : { valid: false, reason: lookup.reason });
}
