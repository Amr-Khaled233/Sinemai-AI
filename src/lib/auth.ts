import type { NextAuthOptions, Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getServerSession } from 'next-auth';
import { compare } from 'bcryptjs';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { consumeRateLimit, LIMITS } from '@/lib/rate-limit';

/** bcrypt hash of a value nobody can supply; used to equalise login timing. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1z4Y2qgqVvJk0Fh3g8QsB9wHqJdM0yW';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.toLowerCase().trim();

        // Slows credential stuffing. Keyed on the email rather than the account
        // so it applies equally to addresses that do not exist, which keeps the
        // endpoint from confirming which ones do.
        const limit = await consumeRateLimit(`login:${email}`, LIMITS.login);
        if (!limit.allowed) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // Comparing against a dummy hash for unknown accounts keeps the timing
        // of "no such user" and "wrong password" roughly equal.
        if (!user) {
          await compare(credentials.password, DUMMY_HASH);
          return null;
        }
        const valid = await compare(credentials.password, user.passwordHash);
        if (!valid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          locale: user.locale,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.locale = (user as { locale?: string }).locale ?? 'en';
        token.authAt = Math.floor(Date.now() / 1000);
      } else if (trigger === 'update' && token.id) {
        // Role can change when an admin approves a vendor/DOP application.
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { role: true, locale: true },
        });
        if (fresh) {
          token.role = fresh.role;
          token.locale = fresh.locale;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // A password reset must end sessions that were minted before it, so a
      // stolen session cannot outlive the credential it was issued against.
      if (token.id && token.authAt) {
        const account = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { passwordChangedAt: true },
        });
        const changedAt = account ? Math.floor(account.passwordChangedAt.getTime() / 1000) : null;
        if (!account || (changedAt !== null && changedAt > (token.authAt as number))) {
          // Dropping the user makes every guard treat this as signed out; the
          // cast is needed because NextAuth types `user` as always present.
          return { ...session, user: undefined } as unknown as Session;
        }
      }

      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.locale = (token.locale as string) ?? 'en';
      }
      return session;
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}

export type AppSession = Session & {
  user: { id: string; role: Role; email: string; name: string; locale: string };
};

/** Server-side guard: redirects to login (or the user's own home) on mismatch. */
export async function requireUser(locale = 'en') {
  const session = (await auth()) as AppSession | null;
  if (!session?.user) redirect(`/${locale}/login`);
  return session;
}

export async function requireRole(role: Role | Role[], locale = 'en') {
  const session = await requireUser(locale);
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(session.user.role)) redirect(`/${locale}${homeForRole(session.user.role)}`);
  return session;
}

export function homeForRole(role: Role) {
  switch (role) {
    case 'ADMIN':
      return '/admin';
    case 'VENDOR':
      return '/vendor';
    case 'DOP':
      return '/dop';
    default:
      return '/producer';
  }
}
